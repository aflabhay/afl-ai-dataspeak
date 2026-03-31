/**
 * src/utils/question.generator.js
 * ─────────────────────────────────
 * Generates suggested questions from actual column metadata.
 * Supports both single-table and multi-table (with JOIN detection).
 */

const logger = require('./logger');

const MAX_COLS_IN_PROMPT = 60; // per table — keeps prompt lean for wide tables

// ── Single-table generation ───────────────────────────────────────────────────

async function generateQuestions(tableName, columns, aiClient) {
  return generateQuestionsMultiTable([{ tableName, columns }], aiClient);
}

// ── Multi-table generation ────────────────────────────────────────────────────

/**
 * Generate categorised questions across one or more tables.
 * When multiple tables are provided:
 *   - Detects potential join keys (columns shared across tables by name)
 *   - Includes cross-table JOIN questions in the prompt
 *   - Generates questions that span all tables, not just individual ones
 *
 * @param {Array<{ tableName: string, columns: object[] }>} tables
 * @param {object} aiClient — has .ask(systemPrompt, messages)
 * @returns {Promise<Array<{ category: string, questions: string[] }>>}
 */
async function generateQuestionsMultiTable(tables, aiClient) {
  if (!tables || tables.length === 0) return [];

  // Single table path — same as before
  if (tables.length === 1) {
    const { tableName, columns } = tables[0];
    return _generateForSchema([{ tableName, columns }], [], aiClient);
  }

  // Multi-table: detect join keys
  const joinKeys = detectJoinKeys(tables);
  logger.info(`question.generator: ${tables.length} tables, detected join keys: ${joinKeys.map(j => j.column).join(', ') || 'none'}`);

  return _generateForSchema(tables, joinKeys, aiClient);
}

/**
 * Core prompt builder + AI call.
 * @param {Array<{ tableName, columns }>} tables
 * @param {Array<{ column, tables }>}     joinKeys  — detected common columns
 */
async function _generateForSchema(tables, joinKeys, aiClient) {
  // Build schema block for each table
  const tableBlocks = tables.map(({ tableName, columns }) => {
    let promptCols = columns;
    if (columns.length > MAX_COLS_IN_PROMPT) {
      const enriched  = columns.filter(c => c.description || (c.samples && c.samples.length > 0));
      const remaining = columns.filter(c => !c.description && !(c.samples && c.samples.length > 0));
      promptCols = [...enriched, ...remaining].slice(0, MAX_COLS_IN_PROMPT);
    }
    const colLines = promptCols.map(col => {
      const samples = col.samples?.length > 0 ? ` [e.g. ${col.samples.slice(0, 3).join(', ')}]` : '';
      const desc    = col.description ? ` — ${col.description}` : '';
      return `  - ${col.name} (${col.type})${samples}${desc}`;
    }).join('\n');
    return `Table: ${tableName}\n${colLines}`;
  }).join('\n\n');

  // Join hints block
  let joinSection = '';
  if (joinKeys.length > 0) {
    const joinLines = joinKeys.map(j =>
      `  - "${j.column}" appears in: ${j.tables.join(', ')}`
    ).join('\n');
    joinSection = `\nPotential join keys (columns shared across tables):\n${joinLines}\n`;
  }

  const isMulti    = tables.length > 1;
  const tableNames = tables.map(t => t.tableName).join(', ');

  const systemPrompt = `You are a business analyst helping users discover insights from data tables.
Your job is to generate suggested questions that can be FULLY answered using ONLY the columns listed.
Never invent column names. Never suggest metrics that require columns not in the list.`;

  const userMessage = `${isMulti ? `Tables: ${tableNames}` : `Table: ${tableNames}`}

${tableBlocks}
${joinSection}
Generate ${isMulti ? '14–18' : '12–16'} suggested business questions grouped into ${isMulti ? '5–6' : '4–5'} meaningful categories.

Rules:
- Every question must be answerable using ONLY the columns listed above
- Reference actual column names or sample values where it makes the question concrete
- Each category must have 2–4 questions
- Categories should reflect what the columns actually support
- Questions should be specific and actionable, not vague
${isMulti ? `- Include at least one category with cross-table questions that JOIN ${tables.map(t => t.tableName).join(' and ')} using the shared keys
- Cross-table questions should uncover insights impossible from a single table alone` : ''}

Respond with ONLY valid JSON — no explanation, no markdown:
{
  "categories": [
    { "category": "Category Name", "questions": ["Question 1", "Question 2"] }
  ]
}`;

  try {
    const { text } = await aiClient.ask(systemPrompt, [{ role: 'user', content: userMessage }]);

    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/i) || text.match(/(\{[\s\S]*\})/);
    if (!jsonMatch) {
      logger.warn(`question.generator: no JSON found in AI response for ${tableNames}`);
      return [];
    }

    const parsed     = JSON.parse(jsonMatch[1].trim());
    const categories = parsed?.categories;

    if (!Array.isArray(categories)) {
      logger.warn(`question.generator: unexpected response shape for ${tableNames}`);
      return [];
    }

    return categories
      .filter(c => c.category && Array.isArray(c.questions) && c.questions.length > 0)
      .map(c => ({
        category:  c.category.trim(),
        questions: c.questions.filter(q => typeof q === 'string' && q.trim()).map(q => q.trim()),
      }));

  } catch (err) {
    logger.warn(`question.generator: failed for ${tableNames}: ${err.message}`);
    return [];
  }
}

// ── Join key detection ────────────────────────────────────────────────────────

/**
 * Find columns that appear in more than one table by name (case-insensitive).
 * These are likely join keys or shared dimension columns.
 *
 * @param {Array<{ tableName, columns }>} tables
 * @returns {Array<{ column: string, tables: string[] }>}
 */
function detectJoinKeys(tables) {
  // Build column → [tableNames] map
  const colMap = new Map();
  for (const { tableName, columns } of tables) {
    for (const col of columns) {
      const key = col.name.toLowerCase();
      if (!colMap.has(key)) colMap.set(key, { original: col.name, tables: [] });
      colMap.get(key).tables.push(tableName);
    }
  }

  // Only columns present in 2+ tables
  return [...colMap.values()]
    .filter(entry => entry.tables.length >= 2)
    .map(entry => ({ column: entry.original, tables: entry.tables }))
    .sort((a, b) => b.tables.length - a.tables.length); // most shared first
}

module.exports = { generateQuestions, generateQuestionsMultiTable };
