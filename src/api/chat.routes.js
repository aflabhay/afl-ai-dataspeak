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

const { randomUUID }  = require('crypto');
const promptBuilder   = require('../claude/prompt.builder');
const sqlExtractor    = require('../claude/sql.extractor');
const bqSchemaFetcher = require('../bigquery/schema.fetcher');
const bqQueryRunner   = require('../bigquery/query.runner');
const fbSchemaFetcher = require('../fabric/schema.fetcher');
const fbQueryRunner   = require('../fabric/query.runner');
const costEstimator   = require('../utils/cost.estimator');
const { pickRelevantTables } = require('../utils/table.picker');
const resultCache            = require('../utils/result.cache');
const semanticCache          = require('../utils/semantic.cache');
const { streamAsk }          = require('../utils/streaming.client');
const { classify }           = require('../utils/intent.classifier');
const confidenceScorer       = require('../utils/confidence.scorer');
const { saveTurn }           = require('../bigquery/history.writer');
const logger                 = require('../utils/logger');

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

// How many previous turns to include as conversation memory
const MAX_HISTORY_TURNS = 6;

router.post('/', async (req, res, next) => {
  const { question, source = 'bigquery', dataset, tables = [], history = [], sessionId } = req.body;
  const user = req.user || {};

  // ── Validate input ────────────────────────────────────────────────────────
  if (!question || typeof question !== 'string' || question.trim() === '') {
    return res.status(400).json({ error: '`question` is required and must be a non-empty string.' });
  }

  if (!['bigquery', 'fabric'].includes(source)) {
    return res.status(400).json({ error: '`source` must be "bigquery" or "fabric".' });
  }

  try {
    const startTime  = Date.now();
    const turnId     = randomUUID();
    const aiClient   = getAIClient();
    const isOpenAI   = (process.env.AI_PROVIDER || 'openai').toLowerCase() === 'openai';
    const aiProvider = isOpenAI ? 'GPT-4o-mini' : 'Claude';

    // ── Step 1: Semantic cache lookup ─────────────────────────────────────────
    const semanticHit = await semanticCache.lookup(question, dataset, tables, source);
    if (semanticHit) {
      logger.info(`Returning semantic cache hit for: "${question}"`);
      return res.json({ ...semanticHit, executionMs: Date.now() - startTime, sessionId });
    }

    // ── Step 2: Classify intent ───────────────────────────────────────────────
    // Determine whether the question needs SQL execution, schema info, or chat.
    const recentHistory = history.slice(-MAX_HISTORY_TURNS);
    const intent        = await classify(question, aiClient);

    // ── OFF_TOPIC intent: hard refusal — no AI call, no cost ─────────────────
    if (intent === 'OFF_TOPIC') {
      logger.info(`OFF_TOPIC intent — refusing: "${question.slice(0, 60)}"`);
      const refusal = "I'm AIDA, AFL's data assistant. I can only help with questions about Arvind Fashions business data — sales, customers, brands, RFM analysis, and related analytics. Please ask me a data question.";
      saveTurn({ id: turnId, sessionId, question, explanation: refusal, aiProvider: 'None', source, dataset, intent: 'OFF_TOPIC', executionMs: Date.now() - startTime, userId: user.id, userName: user.name, userEmail: user.email }).catch(() => {});
      return res.json({
        turnId,
        explanation: refusal,
        sql:         null,
        results:     null,
        rowCount:    0,
        executionMs: Date.now() - startTime,
        sessionId,
        aiProvider:  'None',
        intent:      'OFF_TOPIC',
      });
    }

    // ── SCHEMA intent: describe table fields without running any SQL ──────────
    if (intent === 'SCHEMA') {
      logger.info(`SCHEMA intent — describing fields for: "${question}"`);
      const targetTables = tables.length > 0 ? tables : null;
      let schema;
      if (targetTables) {
        schema = source === 'bigquery'
          ? await bqSchemaFetcher.fetchSchema(dataset, targetTables)
          : await fbSchemaFetcher.fetchSchema(dataset, targetTables);
      } else {
        schema = [];
      }

      const schemaContext = schema.length > 0
        ? schema.map(t =>
            `Table: ${t.tableName}\n` +
            t.columns.map(c => `  - ${c.name} (${c.type})${c.description ? ': ' + c.description : ''}`).join('\n')
          ).join('\n\n')
        : `Dataset: ${dataset}`;

      const schemaPrompt = `You are a helpful data analyst. The user is asking about the structure of their data.
Answer clearly and helpfully. Format column descriptions as a clean list. If you know what the column means in a business context, explain it plainly.

Available schema:
${schemaContext}`;

      const messages = [...recentHistory, { role: 'user', content: question }];
      const { text: explanation, aiCost } = isOpenAI
        ? await streamAsk(schemaPrompt, messages)
        : await aiClient.ask(schemaPrompt, messages);

      const schemaMs = Date.now() - startTime;
      saveTurn({ id: turnId, sessionId, question, explanation, aiProvider, source, dataset, intent: 'SCHEMA', executionMs: schemaMs, userId: user.id, userName: user.name, userEmail: user.email }).catch(() => {});
      return res.json({
        turnId,
        explanation,
        sql:        null,
        results:    null,
        rowCount:   0,
        aiCost,
        executionMs: schemaMs,
        sessionId,
        aiProvider,
        intent:     'SCHEMA',
      });
    }

    // ── CHAT intent: answer conversationally without SQL ─────────────────────
    if (intent === 'CHAT') {
      logger.info(`CHAT intent — answering conversationally: "${question}"`);

      // ── Identity / introductory questions — answer directly ───────────────
      const identityPatterns = /\b(who are you|what are you|tell me about yourself|what can you do|what is aida|how are you built|who made you|what('s| is) your (name|purpose|role)|introduce yourself)\b/i;
      if (identityPatterns.test(question)) {
        const identity = `I'm **AIDA** — Arvind Intelligent Data Assistant, built for Arvind Fashions Limited.

**What I do:**
- Translate your plain-English questions into SQL and run them against AFL's BigQuery and Microsoft Fabric data warehouses
- Answer questions about sales, customers, brands, and all AFL business analytics across any dataset or table
- Explain query results, describe table structures, and help you explore your data

**How I'm built:**
- Natural language → SQL engine powered by Claude (Anthropic) / GPT-4o (OpenAI)
- Connected to Google BigQuery and Microsoft Fabric via secure service accounts
- Authenticated via your AFL Microsoft account (Azure AD)
- Intent classifier routes each question to the right handler — SQL query, schema lookup, or conversational answer
- Semantic cache remembers previous questions so repeat queries are instant

Just ask me a question about AFL data and I'll get you the answer.`;

        const identityMs = Date.now() - startTime;
        saveTurn({ id: turnId, sessionId, question, explanation: identity, aiProvider: 'None', source, dataset, intent: 'CHAT', executionMs: identityMs, userId: user.id, userName: user.name, userEmail: user.email }).catch(() => {});
        return res.json({ turnId, explanation: identity, sql: null, results: null, rowCount: 0, executionMs: identityMs, sessionId, aiProvider: 'None', intent: 'CHAT' });
      }

      // ── Compliments / gratitude — respond warmly ──────────────────────────
      const complimentPatterns = /\b(thank(s| you)|love you|you('re| are) (awesome|amazing|great|fantastic|brilliant|the best|helpful)|great (job|work|answer)|well done|nicely done|appreciate|you rock|good (job|work)|cheers)\b/i;
      if (complimentPatterns.test(question)) {
        const replies = [
          "Thank you, that means a lot! 😊 Happy to help whenever you need data insights.",
          "Glad I could help! Feel free to ask me anything about AFL's data anytime.",
          "That's very kind — thank you! I'm here whenever you have a data question.",
          "Happy to be useful! Just ask whenever you need something from the data.",
          "Thank you! It's a pleasure helping the AFL team with data. What would you like to explore next?",
        ];
        const warmReply = replies[Math.floor(Math.random() * replies.length)];
        const complimentMs = Date.now() - startTime;
        saveTurn({ id: turnId, sessionId, question, explanation: warmReply, aiProvider: 'None', source, dataset, intent: 'CHAT', executionMs: complimentMs, userId: user.id, userName: user.name, userEmail: user.email }).catch(() => {});
        return res.json({ turnId, explanation: warmReply, sql: null, results: null, rowCount: 0, executionMs: complimentMs, sessionId, aiProvider: 'None', intent: 'CHAT' });
      }

      // Fetch schema for context so AI can give accurate SQL advice
      const targetTables = tables.length > 0 ? tables : [];
      let schemaContext  = '';
      if (targetTables.length > 0) {
        try {
          const schema = source === 'bigquery'
            ? await bqSchemaFetcher.fetchSchema(dataset, targetTables)
            : await fbSchemaFetcher.fetchSchema(dataset, targetTables);
          schemaContext = schema.map(t =>
            `Table ${t.tableName}: ` + t.columns.map(c => c.name).join(', ')
          ).join('\n');
        } catch { /* schema context is best-effort */ }
      }

      const chatPrompt = `You are a helpful data analyst and SQL expert working with ${source === 'bigquery' ? 'Google BigQuery' : 'Microsoft Fabric'}.
Answer the user's question clearly and concisely. If giving SQL advice, be specific.
Do not generate a SQL query to execute — just answer the question.
${schemaContext ? `\nRelevant schema context:\n${schemaContext}` : ''}`;

      const messages = [...recentHistory, { role: 'user', content: question }];
      const { text: explanation, aiCost } = isOpenAI
        ? await streamAsk(chatPrompt, messages)
        : await aiClient.ask(chatPrompt, messages);

      const chatMs = Date.now() - startTime;
      saveTurn({ id: turnId, sessionId, question, explanation, aiProvider, source, dataset, intent: 'CHAT', executionMs: chatMs, userId: user.id, userName: user.name, userEmail: user.email }).catch(() => {});
      return res.json({
        turnId,
        explanation,
        sql:        null,
        results:    null,
        rowCount:   0,
        aiCost,
        executionMs: chatMs,
        sessionId,
        aiProvider,
        intent:     'CHAT',
      });
    }

    // ── QUERY intent: continue to SQL generation ──────────────────────────────

    // ── Step 2 (cont): Resolve which tables to use ────────────────────────────
    let targetTables = tables;
    if (!targetTables || targetTables.length === 0) {
      logger.info(`No tables specified — picking relevant tables for: "${question}"`);
      const allTableNames = source === 'bigquery'
        ? await bqSchemaFetcher.listTables(dataset)
        : await fbSchemaFetcher.listTables(dataset);
      targetTables = await pickRelevantTables(question, allTableNames, aiClient);
      logger.info(`Resolved tables: ${targetTables.join(', ')}`);
    }

    // ── Step 3: Fetch schema for relevant tables ──────────────────────────────
    logger.info(`Fetching schema for: ${targetTables.join(', ')}`);
    const schema = source === 'bigquery'
      ? await bqSchemaFetcher.fetchSchema(dataset, targetTables)
      : await fbSchemaFetcher.fetchSchema(dataset, targetTables);

    // ── Step 4: Build prompt + call AI (streaming for OpenAI) ────────────────
    logger.info(`Calling AI for: "${question}"`);
    const systemPrompt = promptBuilder.build({ source, dataset, schema });
    const messages     = [...recentHistory, { role: 'user', content: question }];

    // Use streaming with early termination for OpenAI (saves ~30-50% output tokens).
    // Fall back to regular ask for Claude.
    const { text: aiResponseText, aiCost } = isOpenAI
      ? await streamAsk(systemPrompt, messages)
      : await aiClient.ask(systemPrompt, messages);

    // ── Step 5: Extract SQL, chart config, explanation ────────────────────────
    const { sql, explanation, chart } = sqlExtractor.extract(aiResponseText);

    if (!sql) {
      return res.status(422).json({
        error:       'AI could not generate a valid SQL query for this question.',
        explanation: aiResponseText,
      });
    }
    logger.info(`Generated SQL:\n${sql}`);

    // ── Step 6: Cost guard (BigQuery only) ────────────────────────────────────
    let costInfo = null;
    if (source === 'bigquery') {
      costInfo = await costEstimator.estimate(sql);
      logger.info(`Scan estimate: ${costInfo.estimatedGB} GB | ${costInfo.estimatedCost}`);
      if (costInfo.estimatedGB > MAX_SCAN_GB) {
        return res.status(403).json({
          error: `Query would scan ${costInfo.estimatedGB.toFixed(2)} GB, exceeding the ${MAX_SCAN_GB} GB limit.`,
          sql, costInfo,
        });
      }
    }

    // ── Step 7: Result cache lookup ───────────────────────────────────────────
    // Same SQL + source within TTL → skip the DB query entirely.
    let results       = resultCache.get(sql, source);
    let fromResultCache = false;

    if (results) {
      fromResultCache = true;
      logger.info('Result cache hit — skipping database query');
    } else {
      logger.info(`Executing query on ${source}`);
      if (source === 'bigquery') {
        results = await bqQueryRunner.run(sql);
      } else {
        results = await fbQueryRunner.run(sql);
      }
      resultCache.set(sql, source, results);   // ← store for next time
    }

    const executionMs = Date.now() - startTime;
    logger.info(`Done in ${executionMs}ms — ${results.length} rows (resultCache=${fromResultCache})`);

    // ── Step 8b: Validate + fix chart key names against actual result columns ──
    // The AI sometimes uses non-exact aliases (e.g. "brand" when SQL returns "brand_name").
    // Fix by case-insensitive match; nullify chart if keys still don't resolve.
    let validatedChart = chart;
    if (validatedChart && results.length > 0) {
      const cols = Object.keys(results[0]);
      const fixKey = (key) => {
        if (!key) return key;
        if (cols.includes(key)) return key;                      // exact match
        const ci = cols.find(c => c.toLowerCase() === key.toLowerCase());
        return ci || null;                                       // ci match or null
      };
      const fixedX = fixKey(validatedChart.xKey);
      const fixedY = fixKey(validatedChart.yKey);
      if (!fixedX || !fixedY) {
        logger.warn(`Chart keys (${validatedChart.xKey}, ${validatedChart.yKey}) not found in results — dropping chart`);
        validatedChart = null;
      } else {
        validatedChart = { ...validatedChart, xKey: fixedX, yKey: fixedY };
      }
    }

    // ── Step 9: Algorithmic confidence score ──────────────────────────────────
    // Scored against real metadata signals — not AI self-reporting.
    const { confidenceScore, confidenceReason } = confidenceScorer.score({
      sql,
      schema,
      rowCount: results.length,
    });

    // ── Step 8: Build response + populate semantic cache ─────────────────────
    const truncated = results.length === 100;
    const response  = {
      turnId,
      sql,
      explanation,
      chart: validatedChart,
      results,
      rowCount:         results.length,
      truncated,
      costInfo,
      aiCost,
      confidenceScore,
      confidenceReason,
      executionMs,
      sessionId,
      tablesUsed:       targetTables,
      aiProvider,
      fromResultCache,
      intent:           'QUERY',
    };

    // Save turn to chat history async — don't block the response
    // Store up to 200 chart rows so we can re-render the chart on history load.
    const chartWithData = validatedChart ? { ...validatedChart, data: results.slice(0, 200) } : null;
    saveTurn({
      id:               turnId,
      sessionId,
      question,
      sql,
      explanation,
      chart:            chartWithData,
      aiProvider,
      tablesUsed:       targetTables,
      source,
      dataset,
      rowCount:         results.length,
      executionMs,
      intent:           'QUERY',
      costInfo,
      aiCost,
      confidenceScore,
      confidenceReason,
      userId:           user.id,
      userName:         user.name,
      userEmail:        user.email,
    }).catch(() => {});

    // Store in semantic cache async — don't block the response
    semanticCache.store(question, dataset, targetTables, response, source).catch(() => {});

    return res.json(response);

  } catch (err) {
    next(err);
  }
});

module.exports = router;
