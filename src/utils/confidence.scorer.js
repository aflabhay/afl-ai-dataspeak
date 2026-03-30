/**
 * src/utils/confidence.scorer.js
 * ───────────────────────────────
 * Algorithmic confidence scoring based on verifiable metadata signals.
 *
 * Scoring signals (each checked against real schema/sample data):
 *
 *  +100  base score
 *   -5   each string literal in the WHERE/HAVING clause whose value cannot
 *         be found in any column's sample values (unverified filter)
 *   -5   columns referenced in the SQL that have no business description
 *         (ambiguous intent — AI had to guess meaning)
 *   -5   columns referenced in the SQL that have no sample values at all
 *         (AI could not verify data format or valid values)
 *  -10   query returned 0 rows on a non-aggregation query
 *         (filter may be wrong or data may be missing)
 *
 * Example — "How many customers are in 'Deep Dormant (37 to 48 Months)'?":
 *   - 'Deep Dormant (37 to 48 Months)' IS in sample_values of recency_group_label → no deduction
 *   - column has description → no deduction
 *   - result count > 0 → no deduction
 *   → Score = 100%
 */

/**
 * @param {object}   opts
 * @param {string}   opts.sql        — generated SQL
 * @param {object[]} opts.schema     — [{ tableName, columns: [{ name, description, samples }] }]
 * @param {number}   opts.rowCount   — number of rows returned by the query
 * @returns {{ confidenceScore: number, confidenceReason: string }}
 */
function score({ sql, schema, rowCount }) {
  if (!sql || !schema) {
    return { confidenceScore: null, confidenceReason: null };
  }

  // ── Build a flat column map from schema ───────────────────────────────────
  // key = column_name (lowercase), value = { description, samples }
  const colMap = new Map();
  for (const table of schema) {
    for (const col of table.columns) {
      colMap.set(col.name.toLowerCase(), {
        description: col.description || '',
        samples:     (col.samples || []).map(s => String(s).toLowerCase()),
      });
    }
  }

  // ── Extract column references from SQL (backtick-quoted identifiers) ──────
  // Matches `column_name` but skips `dataset.table` style refs (contain a dot in the full path)
  const backtickRefs = [...sql.matchAll(/`([^`\n.]+)`/g)].map(m => m[1].toLowerCase());
  // Also match unquoted identifiers that directly match known column names
  const referencedCols = [...new Set(backtickRefs)].filter(name => colMap.has(name));

  // ── Extract string literals from SQL (single-quoted values) ───────────────
  const stringLiterals = [...sql.matchAll(/'([^']+)'/g)].map(m => m[1].toLowerCase());

  let deductions = 0;
  const reasons  = [];

  // ── Signal 1: unverified filter values ────────────────────────────────────
  // String literals used as filter values that don't appear in any column's samples
  const allSamples = [...colMap.values()].flatMap(c => c.samples);
  const unmatchedLiterals = stringLiterals.filter(lit => !allSamples.includes(lit));

  if (unmatchedLiterals.length > 0) {
    const penalty = Math.min(20, unmatchedLiterals.length * 5);
    deductions += penalty;
    reasons.push(
      `${unmatchedLiterals.length} filter value${unmatchedLiterals.length > 1 ? 's' : ''} not confirmed in sample data`
    );
  }

  // ── Signal 2: referenced columns with no business description ─────────────
  const colsWithoutDesc = referencedCols.filter(name => !colMap.get(name)?.description?.trim());
  if (colsWithoutDesc.length > 0) {
    const penalty = Math.min(10, colsWithoutDesc.length * 5);
    deductions += penalty;
    reasons.push(`${colsWithoutDesc.length} column${colsWithoutDesc.length > 1 ? 's' : ''} lack business descriptions`);
  }

  // ── Signal 3: referenced columns with no sample values ────────────────────
  const colsWithoutSamples = referencedCols.filter(name => colMap.get(name)?.samples?.length === 0);
  if (colsWithoutSamples.length > 0) {
    const penalty = Math.min(10, colsWithoutSamples.length * 5);
    deductions += penalty;
    reasons.push(`${colsWithoutSamples.length} column${colsWithoutSamples.length > 1 ? 's' : ''} have no sample values`);
  }

  // ── Signal 4: zero rows returned (non-aggregation queries only) ───────────
  // Aggregations (COUNT, SUM, AVG etc.) always return at least one row,
  // so 0 rows there is valid. Only penalise row-level queries.
  const isAggregation = /\b(COUNT|SUM|AVG|MIN|MAX|GROUP\s+BY)\b/i.test(sql);
  if (!isAggregation && rowCount === 0) {
    deductions += 10;
    reasons.push('query returned 0 rows — filter values may not match real data');
  }

  const confidenceScore  = Math.max(0, 100 - deductions);
  const confidenceReason = reasons.length === 0
    ? 'All filter values verified against sample data; columns fully documented'
    : reasons.join('; ');

  return { confidenceScore, confidenceReason };
}

module.exports = { score };
