/**
 * tests/unit/sql.extractor.test.js
 * ──────────────────────────────────
 * Unit tests for the SQL extractor utility.
 */

const { extract, validateReadOnly } = require('../../src/claude/sql.extractor');

describe('sql.extractor — extract()', () => {

  test('extracts SQL from a standard ```sql block', () => {
    const response = `
Here is the query:

\`\`\`sql
SELECT date, COUNT(*) AS total
FROM \`DCOE_Production.t_nnnow_fusion_conversations\`
GROUP BY date
ORDER BY date DESC
LIMIT 100
\`\`\`

This query counts conversations per day.
    `;
    const { sql, explanation } = extract(response);
    expect(sql).toContain('SELECT date');
    expect(sql).toContain('LIMIT 100');
    expect(explanation).toContain('counts conversations');
  });

  test('returns null SQL when no code block is found', () => {
    const { sql } = extract('I cannot generate a query for that.');
    expect(sql).toBeNull();
  });

  test('handles empty input gracefully', () => {
    const { sql, explanation } = extract('');
    expect(sql).toBeNull();
    expect(explanation).toBe('');
  });

  test('handles null input gracefully', () => {
    const { sql } = extract(null);
    expect(sql).toBeNull();
  });

  test('is case-insensitive for sql block marker', () => {
    const response = '```SQL\nSELECT 1\n```';
    const { sql } = extract(response);
    expect(sql).toBe('SELECT 1');
  });

});

describe('sql.extractor — validateReadOnly()', () => {

  test('accepts a valid SELECT query', () => {
    const { valid } = validateReadOnly('SELECT * FROM table LIMIT 10');
    expect(valid).toBe(true);
  });

  test('blocks INSERT statement', () => {
    const { valid, reason } = validateReadOnly('INSERT INTO table VALUES (1)');
    expect(valid).toBe(false);
    expect(reason).toContain('INSERT');
  });

  test('blocks DROP statement', () => {
    const { valid } = validateReadOnly('DROP TABLE my_table');
    expect(valid).toBe(false);
  });

  test('blocks DELETE statement', () => {
    const { valid } = validateReadOnly('DELETE FROM table WHERE id = 1');
    expect(valid).toBe(false);
  });

  test('blocks UPDATE statement', () => {
    const { valid } = validateReadOnly('UPDATE table SET col = 1');
    expect(valid).toBe(false);
  });

  test('rejects empty SQL', () => {
    const { valid } = validateReadOnly('');
    expect(valid).toBe(false);
  });

  test('rejects query with no SELECT', () => {
    const { valid } = validateReadOnly('FROM table LIMIT 10');
    expect(valid).toBe(false);
  });

});
