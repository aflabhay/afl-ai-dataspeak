/**
 * src/utils/question.generator.js
 * ─────────────────────────────────
 * Dynamically generates suggested questions for a table using actual column
 * metadata (name, type, business description, sample values).
 *
 * Only generates questions that are answerable given the available columns —
 * no hallucinated field names or unsupported aggregations.
 */

const logger = require('./logger');

/**
 * Generate categorised suggested questions for a table.
 *
 * @param {string}   tableName
 * @param {object[]} columns    — [{ name, type, description, samples }]
 * @param {object}   aiClient   — has .ask(systemPrompt, messages)
 * @returns {Promise<Array<{ category: string, questions: string[] }>>}
 */
const MAX_COLS_IN_PROMPT = 60; // keep prompt lean for wide tables

async function generateQuestions(tableName, columns, aiClient) {
  if (!columns || columns.length === 0) return [];

  // For tables with many columns, prioritise enriched columns (those with
  // descriptions or sample values) so the prompt stays within token budget.
  let promptCols = columns;
  if (columns.length > MAX_COLS_IN_PROMPT) {
    const enriched  = columns.filter(c => c.description || (c.samples && c.samples.length > 0));
    const remaining = columns.filter(c => !c.description && !(c.samples && c.samples.length > 0));
    promptCols = [...enriched, ...remaining].slice(0, MAX_COLS_IN_PROMPT);
    logger.info(`question.generator: ${tableName} has ${columns.length} columns — using top ${MAX_COLS_IN_PROMPT} for prompt`);
  }

  // Build a compact schema summary for the prompt
  const schemaLines = promptCols.map(col => {
    const samples = col.samples?.length > 0
      ? ` [e.g. ${col.samples.slice(0, 3).join(', ')}]`
      : '';
    const desc = col.description ? ` — ${col.description}` : '';
    return `  - ${col.name} (${col.type})${samples}${desc}`;
  }).join('\n');

  const systemPrompt = `You are a business analyst helping users discover insights from a data table.
Your job is to generate suggested questions that can be FULLY answered using ONLY the columns listed below.
Never invent column names. Never suggest metrics that require columns not in the list.`;

  const userMessage = `Table: ${tableName}

Available columns:
${schemaLines}

Generate 12–16 suggested business questions grouped into 4–5 meaningful categories.
Rules:
- Every question must be answerable using ONLY the columns listed above
- Reference actual column names or sample values where it makes the question concrete (e.g. use a real brand name from sample values instead of "each brand")
- Each category must have 2–4 questions
- Categories should reflect what the columns actually support (e.g. if there are date columns, include a trends category; if geography columns exist, include geographic insights)
- Questions should be specific and actionable, not vague

Respond with ONLY valid JSON in this exact format, no explanation:
{
  "categories": [
    {
      "category": "Category Name",
      "questions": ["Question 1", "Question 2", "Question 3"]
    }
  ]
}`;

  try {
    const { text } = await aiClient.ask(systemPrompt, [{ role: 'user', content: userMessage }]);

    // Extract JSON from response (handle markdown fences if present)
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/i) || text.match(/(\{[\s\S]*\})/);
    if (!jsonMatch) {
      logger.warn(`question.generator: no JSON found in AI response for ${tableName}`);
      return [];
    }

    const parsed = JSON.parse(jsonMatch[1].trim());
    const categories = parsed?.categories;

    if (!Array.isArray(categories)) {
      logger.warn(`question.generator: unexpected response shape for ${tableName}`);
      return [];
    }

    // Normalise: ensure every question is a non-empty string
    return categories
      .filter(c => c.category && Array.isArray(c.questions) && c.questions.length > 0)
      .map(c => ({
        category:  c.category.trim(),
        questions: c.questions.filter(q => typeof q === 'string' && q.trim()).map(q => q.trim()),
      }));

  } catch (err) {
    logger.warn(`question.generator: failed for ${tableName}: ${err.message}`);
    return [];
  }
}

module.exports = { generateQuestions };
