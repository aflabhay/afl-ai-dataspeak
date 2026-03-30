/**
 * src/claude/sql.extractor.js
 * ───────────────────────────
 * Parses Claude's free-text response and extracts:
 *  - The SQL query (from a ```sql ... ``` code block)
 *  - The plain-English explanation (everything after the code block)
 *
 * Claude reliably wraps SQL in ```sql blocks when instructed to do so
 * in the system prompt. This extractor handles edge cases gracefully.
 */

/**
 * Extract SQL, chart config, and explanation from the AI response text.
 *
 * @param {string} response — full text response from AI
 * @returns {{ sql: string|null, explanation: string, chart: object|null }}
 */
function extract(response) {
  if (!response || typeof response !== 'string') {
    return { sql: null, explanation: '', chart: null };
  }

  // Extract ```sql ... ``` block
  const sqlBlockRegex = /```sql\s*([\s\S]*?)\s*```/i;
  const sqlMatch = response.match(sqlBlockRegex);

  // Extract ```json ... ``` block (chart config)
  const jsonBlockRegex = /```json\s*([\s\S]*?)\s*```/i;
  const jsonMatch = response.match(jsonBlockRegex);

  let chart = null;
  if (jsonMatch) {
    try { chart = JSON.parse(jsonMatch[1].trim()); } catch { /* ignore bad JSON */ }
  }

  // Clean explanation: remove both code blocks
  let explanation = response
    .replace(sqlBlockRegex, '')
    .replace(jsonBlockRegex, '')
    .trim();

  if (!sqlMatch) {
    // Fallback: strip the JSON block then stop at a blank line (paragraph break
    // between SQL and plain-English explanation) or semicolon.
    // Never use bare `$` — it would capture the entire explanation as SQL.
    const cleanedForFallback = response.replace(jsonBlockRegex, '').trim();
    const selectRegex = /(SELECT[\s\S]+?)(?:;|(?=\n\n)|$(?!\n))/i;
    const fallback = cleanedForFallback.match(selectRegex);
    return { sql: fallback ? fallback[1].trim() : null, explanation, chart };
  }

  return { sql: sqlMatch[1].trim(), explanation, chart };
}

/**
 * Validate that a SQL string is a read-only SELECT statement.
 * Blocks any destructive operations as a safety net.
 *
 * @param {string} sql
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateReadOnly(sql) {
  if (!sql) return { valid: false, reason: 'Empty SQL' };

  const normalized = sql.trim().toUpperCase();

  const BLOCKED = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'TRUNCATE', 'ALTER', 'MERGE'];

  for (const keyword of BLOCKED) {
    // Match as a whole word at the start (after optional whitespace/CTEs)
    if (new RegExp(`\\b${keyword}\\b`).test(normalized)) {
      return { valid: false, reason: `Blocked keyword: ${keyword}` };
    }
  }

  if (!normalized.includes('SELECT')) {
    return { valid: false, reason: 'Query must contain SELECT' };
  }

  return { valid: true };
}

module.exports = { extract, validateReadOnly };
