/**
 * src/utils/table.picker.js
 * ──────────────────────────
 * Uses AI to identify which tables in a dataset are relevant
 * to a user's question — before fetching full column schemas.
 *
 * This keeps prompts small: only the schemas of relevant tables
 * are sent in the SQL-generation step.
 */

const logger = require('./logger');

const MAX_RELEVANT_TABLES = 5;

/**
 * Ask the AI to pick relevant table names for a given question.
 *
 * @param {string}   question   — user's natural language question
 * @param {string[]} tableNames — all table names in the dataset
 * @param {object}   aiClient   — AI client with .ask(system, user) method
 * @returns {Promise<string[]>} — subset of tableNames deemed relevant
 */
async function pickRelevantTables(question, tableNames, aiClient) {
  if (tableNames.length === 0) return [];

  // If small enough, skip AI selection and use all tables directly
  if (tableNames.length <= MAX_RELEVANT_TABLES) return tableNames;

  const systemPrompt = `You are a data analyst. Given a list of database table names and a user question,
identify which tables are most likely needed to answer the question.

Rules:
- Return ONLY a JSON array of table name strings, nothing else
- Pick at most ${MAX_RELEVANT_TABLES} tables
- Choose based on table name relevance to the question
- If unsure, include tables that might have related data

Example output: ["t_orders", "t_customers"]`;

  const userMessage = `Question: ${question}

Available tables:
${tableNames.join('\n')}

Which tables are needed to answer this question? Return only a JSON array.`;

  try {
    const { text } = await aiClient.ask(systemPrompt, userMessage);

    // Extract JSON array from response
    const match = text.match(/\[[\s\S]*?\]/);
    if (!match) throw new Error('No JSON array found in response');

    const picked = JSON.parse(match[0]);


    // Validate — only return names that actually exist
    const valid = picked.filter(name => tableNames.includes(name));
    logger.info(`Table picker selected: ${valid.join(', ')}`);
    return valid.length > 0 ? valid : tableNames.slice(0, MAX_RELEVANT_TABLES);

  } catch (err) {
    logger.warn(`Table picker failed (${err.message}), falling back to first ${MAX_RELEVANT_TABLES} tables`);
    return tableNames.slice(0, MAX_RELEVANT_TABLES);
  }
}

module.exports = { pickRelevantTables };
