/**
 * src/utils/intent.classifier.js
 * ────────────────────────────────
 * Classifies user questions into one of three intents before routing:
 *
 *  QUERY        — needs SQL generated and executed against the database
 *                 e.g. "show top 10 brands by revenue", "count customers last month"
 *
 *  SCHEMA       — asking about table structure, field names, or data types
 *                 e.g. "what fields does rfm table have?", "describe the columns"
 *
 *  CHAT         — conversational: advice, clarification, SQL help, best practices
 *                 e.g. "should I use COUNT DISTINCT?", "what does RFM mean?",
 *                      "why did the previous query return 0 rows?"
 *
 * Uses a short, cheap AI call (< 50 output tokens) to classify.
 * Falls back to QUERY on any failure so existing behaviour is preserved.
 */

const logger = require('./logger');

const SYSTEM_PROMPT = `You are a query intent classifier. Classify the user's question into exactly one of:

QUERY   - needs data retrieved from a database (counts, aggregations, lists, trends, comparisons)
SCHEMA  - asking about table/column structure, field names, data types, what columns exist, what a field means
CHAT    - conversational question: SQL advice, best practices, clarifications, explanations about previous results, general data questions that don't need a DB query

Reply with ONLY the single word: QUERY, SCHEMA, or CHAT. No explanation.

Examples:
"show me top 10 customers by revenue" → QUERY
"which fields does the rfm table have?" → SCHEMA
"what does the cohort_segment column mean?" → SCHEMA
"should I use COUNT or COUNT DISTINCT for customers?" → CHAT
"why did the last query return zero rows?" → CHAT
"what is RFM analysis?" → CHAT
"give me monthly sales by brand" → QUERY`;

/**
 * Classify the intent of a user question.
 *
 * @param {string} question
 * @param {object} aiClient — must expose .ask(systemPrompt, messages)
 * @returns {Promise<'QUERY'|'SCHEMA'|'CHAT'>}
 */
async function classify(question, aiClient) {
  try {
    const { text } = await aiClient.ask(SYSTEM_PROMPT, question);
    const intent   = text.trim().toUpperCase();

    if (['QUERY', 'SCHEMA', 'CHAT'].includes(intent)) {
      logger.info(`Intent classified: ${intent} for "${question.slice(0, 60)}"`);
      return intent;
    }

    // Model returned something unexpected — default to QUERY
    logger.warn(`Intent classifier returned unexpected value: "${text}" — defaulting to QUERY`);
    return 'QUERY';

  } catch (err) {
    logger.warn(`Intent classifier failed (${err.message}) — defaulting to QUERY`);
    return 'QUERY';
  }
}

module.exports = { classify };
