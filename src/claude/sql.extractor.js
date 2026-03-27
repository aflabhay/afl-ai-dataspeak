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
 * Extract SQL and explanation from Claude's response text.
 *
 * @param {string} response — full text response from Claude
 * @returns {{ sql: string|null, explanation: string }}
 */
function extract(response) {
  if (!response || typeof response !== 'string') {
    return { sql: null, explanation: '' };
  }

  // Match ```sql ... ``` block (case-insensitive, multiline)
  const sqlBlockRegex = /```sql\s*([\s\S]*?)\s*```/i;
  const match = response.match(sqlBlockRegex);

  if (!match) {
    // Fallback: try to find a raw SELECT statement
    const selectRegex = /(SELECT[\s\S]+?(?:LIMIT\s+\d+|;|$))/i;
    const fallback = response.match(selectRegex);

    return {
      sql:         fallback ? fallback[1].trim() : null,
      explanation: response.trim(),
    };
  }

  const sql         = match[1].trim();
  const explanation = response.replace(sqlBlockRegex, '').trim();

  return { sql, explanation };
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
