/**
 * src/api/questions.routes.js
 * ────────────────────────────
 * GET /api/questions?table=tableName&dataset=DCOE_Production&source=bigquery
 *
 * Dynamically generates suggested questions based on the actual column metadata
 * for the selected table (names, types, descriptions, sample values from
 * t_aida_table_column_metadata). Questions are guaranteed to be answerable
 * with the available columns — no hallucinated fields.
 *
 * Results are cached in memory per table+dataset for 30 minutes to avoid
 * re-generating on every sidebar load.
 *
 * Response:
 *   { categories: [ { category: string, questions: string[] } ] }
 */

const express  = require('express');
const router   = express.Router();

const columnMetadata      = require('../bigquery/column.metadata');
const bqSchemaFetcher     = require('../bigquery/schema.fetcher');
const fbSchemaFetcher     = require('../fabric/schema.fetcher');
const { generateQuestions } = require('../utils/question.generator');
const { fetchGeneratedQuestions, saveGeneratedQuestions } = require('../bigquery/questions.store');
const { streamAsk }       = require('../utils/streaming.client');
const logger              = require('../utils/logger');

// ── In-memory cache: key = "source.dataset.table", TTL 30 min ────────────────
// L1: in-memory (fast, resets on restart)
// L2: BigQuery t_aida_dynamic_questions (permanent — generated once, never regenerated)
const cache    = new Map();
const TTL_MS   = 30 * 60 * 1000;

function getAIClient() {
  const provider = (process.env.AI_PROVIDER || 'claude').toLowerCase();
  if (provider === 'openai') return require('../openai/openai.client');
  return require('../claude/claude.client');
}

router.get('/', async (req, res, next) => {
  const tableName = (req.query.table   || '').trim();
  const dataset   = (req.query.dataset || '').trim();
  const source    = (req.query.source  || 'bigquery').trim();

  if (!tableName || !dataset) {
    return res.json({ categories: [] });
  }

  const cacheKey = `${source}.${dataset}.${tableName}`;

  // ── L1: In-memory cache hit ─────────────────────────────────────────────────
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.generatedAt < TTL_MS) {
    logger.info(`Question cache hit (memory) for ${tableName}`);
    return res.json({ categories: hit.categories });
  }

  try {
    // ── L2: BigQuery persisted questions ─────────────────────────────────────
    const bqStored = await fetchGeneratedQuestions(tableName, dataset, source);
    if (bqStored && bqStored.length > 0) {
      logger.info(`Question cache hit (BigQuery) for ${tableName} (${bqStored.length} categories)`);
      cache.set(cacheKey, { categories: bqStored, generatedAt: Date.now() });
      return res.json({ categories: bqStored });
    }

    // ── Fetch column metadata (proactively creates metadata if missing) ───────
    // Always call fetchSchema() first — this triggers source sampling and
    // populates t_aida_table_column_metadata if the table has never been queried.
    logger.info(`Fetching schema to proactively create metadata for ${tableName}`);
    const schema = source === 'bigquery'
      ? await bqSchemaFetcher.fetchSchema(dataset, [tableName])
      : await fbSchemaFetcher.fetchSchema(dataset, [tableName]);

    // Now try metadata table (should be populated by fetchSchema above)
    let columns = [];
    const metaMap = await columnMetadata.getSamples(dataset, tableName);

    if (metaMap && Object.keys(metaMap).length > 0) {
      columns = Object.entries(metaMap).map(([name, meta]) => ({
        name,
        type:        meta.dataType || 'STRING',
        description: meta.description || '',
        samples:     meta.samples || [],
      }));
    } else {
      // Use schema columns (no samples yet — metadata creation may be in-flight)
      const tableSchema = schema?.[0];
      if (tableSchema) {
        columns = tableSchema.columns.map(c => ({
          name:        c.name,
          type:        c.type,
          description: c.description || '',
          samples:     c.samples || [],
        }));
      }
    }

    if (columns.length === 0) {
      return res.json({ categories: [] });
    }

    logger.info(`Generating questions for ${tableName} (${columns.length} columns)`);

    const aiClient  = getAIClient();
    const isOpenAI  = (process.env.AI_PROVIDER || 'openai').toLowerCase() === 'openai';

    const client = {
      ask: (systemPrompt, messages) => isOpenAI
        ? require('../openai/openai.client').ask(systemPrompt, messages)
        : aiClient.ask(systemPrompt, messages),
    };

    const categories = await generateQuestions(tableName, columns, client);

    // ── Store in L1 (memory) + L2 (BigQuery) ─────────────────────────────────
    cache.set(cacheKey, { categories, generatedAt: Date.now() });
    // Save to BQ async — don't block the response
    saveGeneratedQuestions(tableName, dataset, source, categories).catch(err =>
      logger.warn(`Failed to save questions to BigQuery: ${err.message}`)
    );

    logger.info(`Generated ${categories.length} categories for ${tableName} — permanently saved to BigQuery`);

    return res.json({ categories });

  } catch (err) {
    logger.error(`Questions generation failed: ${err.message}`);
    next(err);
  }
});

/**
 * DELETE /api/questions/cache?table=...&dataset=...&source=...
 * Force-regenerates questions for a table by clearing its cache entry.
 */
router.delete('/cache', (req, res) => {
  const tableName = (req.query.table   || '').trim();
  const dataset   = (req.query.dataset || '').trim();
  const source    = (req.query.source  || 'bigquery').trim();

  if (tableName && dataset) {
    cache.delete(`${source}.${dataset}.${tableName}`);
    logger.info(`Question cache cleared for ${tableName}`);
    return res.json({ ok: true });
  }

  cache.clear();
  logger.info('Question cache cleared (all tables)');
  return res.json({ ok: true });
});

module.exports = router;
