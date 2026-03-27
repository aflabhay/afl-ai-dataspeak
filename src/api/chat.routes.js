/**
 * src/api/chat.routes.js
 * ──────────────────────
 * POST /api/chat
 *
 * Accepts a natural language question, determines the data source
 * (BigQuery or Fabric), generates SQL via Claude, runs the query,
 * and returns results + metadata.
 *
 * Request body:
 *   {
 *     question : string   — natural language question
 *     source   : string   — "bigquery" | "fabric"
 *     dataset  : string   — BigQuery dataset OR Fabric schema
 *     tables   : string[] — (optional) specific tables to focus on
 *   }
 *
 * Response:
 *   {
 *     sql         : string   — the generated SQL
 *     explanation : string   — Claude's explanation of the query
 *     results     : object[] — query result rows
 *     rowCount    : number
 *     costInfo    : object   — estimated scan cost (BigQuery only)
 *     executionMs : number   — query execution time
 *   }
 */

const express = require('express');
const router  = express.Router();

const promptBuilder   = require('../claude/prompt.builder');
const sqlExtractor    = require('../claude/sql.extractor');
const bqSchemaFetcher = require('../bigquery/schema.fetcher');
const bqQueryRunner   = require('../bigquery/query.runner');
const fbSchemaFetcher = require('../fabric/schema.fetcher');
const fbQueryRunner   = require('../fabric/query.runner');
const costEstimator   = require('../utils/cost.estimator');
const logger          = require('../utils/logger');

const MAX_SCAN_GB = parseFloat(process.env.MAX_BQ_SCAN_GB || '5');

// ── AI Provider Factory ───────────────────────────────────────────────────────
// Set AI_PROVIDER=openai or AI_PROVIDER=claude in your .env file.
// No code changes needed to switch — just update the env var and restart.
function getAIClient() {
  const provider = (process.env.AI_PROVIDER || 'claude').toLowerCase();
  if (provider === 'openai') {
    logger.info('Using AI provider: OpenAI (GPT-4o)');
    return require('../openai/openai.client');
  }
  logger.info('Using AI provider: Anthropic Claude');
  return require('../claude/claude.client');
}

router.post('/', async (req, res, next) => {
  const { question, source = 'bigquery', dataset, tables = [] } = req.body;

  // ── Validate input ────────────────────────────────────────────────────────
  if (!question || typeof question !== 'string' || question.trim() === '') {
    return res.status(400).json({ error: '`question` is required and must be a non-empty string.' });
  }

  if (!['bigquery', 'fabric'].includes(source)) {
    return res.status(400).json({ error: '`source` must be "bigquery" or "fabric".' });
  }

  try {
    const startTime = Date.now();

    // ── Step 1: Fetch schema for context ─────────────────────────────────────
    logger.info(`Fetching schema for source=${source} dataset=${dataset}`);
    let schema;
    if (source === 'bigquery') {
      schema = await bqSchemaFetcher.fetchSchema(dataset, tables);
    } else {
      schema = await fbSchemaFetcher.fetchSchema(dataset, tables);
    }

    // ── Step 2: Build prompt and call Claude ──────────────────────────────────
    logger.info(`Calling Claude for question: "${question}"`);
    const systemPrompt = promptBuilder.build({ source, dataset, schema });
    const claudeResponse = await claudeClient.ask(systemPrompt, question);

    // ── Step 3: Extract SQL from Claude's response ────────────────────────────
    const { sql, explanation } = sqlExtractor.extract(claudeResponse);

    if (!sql) {
      return res.status(422).json({
        error: 'Claude could not generate a valid SQL query for this question.',
        explanation: claudeResponse,
      });
    }

    logger.info(`Generated SQL:\n${sql}`);

    // ── Step 4: Cost guard (BigQuery only) ────────────────────────────────────
    let costInfo = null;
    if (source === 'bigquery') {
      costInfo = await costEstimator.estimate(sql);
      logger.info(`Estimated scan: ${costInfo.estimatedGB} GB | Cost: $${costInfo.estimatedCost}`);

      if (costInfo.estimatedGB > MAX_SCAN_GB) {
        return res.status(403).json({
          error: `Query would scan ${costInfo.estimatedGB.toFixed(2)} GB which exceeds the ${MAX_SCAN_GB} GB limit.`,
          sql,
          costInfo,
        });
      }
    }

    // ── Step 5: Execute query ─────────────────────────────────────────────────
    logger.info(`Executing query on ${source}`);
    let results;
    if (source === 'bigquery') {
      results = await bqQueryRunner.run(sql);
    } else {
      results = await fbQueryRunner.run(sql);
    }

    const executionMs = Date.now() - startTime;
    logger.info(`Query returned ${results.length} rows in ${executionMs}ms`);

    // ── Step 6: Return response ───────────────────────────────────────────────
    return res.json({
      sql,
      explanation,
      results,
      rowCount: results.length,
      costInfo,
      executionMs,
    });

  } catch (err) {
    next(err);
  }
});

module.exports = router;
