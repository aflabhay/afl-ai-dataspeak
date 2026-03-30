/**
 * src/fabric/query.runner.js
 * ───────────────────────────
 * Executes a T-SQL SELECT query against Microsoft Fabric
 * and returns results as plain JavaScript objects.
 */

const { getPool }      = require('./fabric.client');
const { validateReadOnly } = require('../claude/sql.extractor');
const logger = require('../utils/logger');

const MAX_ROWS       = 100;
const QUERY_TIMEOUT  = 60_000;

/**
 * Run a T-SQL query and return rows as plain objects.
 *
 * @param {string} sql — validated SELECT statement
 * @returns {Promise<object[]>}
 */
async function run(sql) {
  const { valid, reason } = validateReadOnly(sql);
  if (!valid) {
    throw new Error(`Query blocked for safety: ${reason}`);
  }

  logger.info('Running Fabric query...');
  const pool   = await getPool();
  const result = await Promise.race([
    pool.request().query(sql),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Fabric query timed out after ${QUERY_TIMEOUT / 1000}s`)), QUERY_TIMEOUT)
    ),
  ]);

  const rows = result.recordset || [];

  if (rows.length > MAX_ROWS) {
    logger.warn(`Fabric result truncated to ${MAX_ROWS} rows`);
    return rows.slice(0, MAX_ROWS);
  }

  return rows;
}

module.exports = { run };
