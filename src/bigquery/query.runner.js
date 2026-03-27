/**
 * src/bigquery/query.runner.js
 * ─────────────────────────────
 * Executes a SQL query against BigQuery and returns results as
 * a plain JavaScript array of objects.
 *
 * Safety measures:
 *  - read-only job configuration (no writes)
 *  - query timeout of 60 seconds
 *  - result cap of 10,000 rows
 */

const { getClient }    = require('./bigquery.client');
const { validateReadOnly } = require('../claude/sql.extractor');
const logger = require('../utils/logger');

const MAX_ROWS      = 10_000;
const TIMEOUT_MS    = 60_000; // 60 seconds

/**
 * Run a SQL query and return rows as plain objects.
 *
 * @param {string} sql — validated SELECT statement
 * @returns {Promise<object[]>}
 */
async function run(sql) {
  // Safety check: block destructive queries
  const { valid, reason } = validateReadOnly(sql);
  if (!valid) {
    throw new Error(`Query blocked for safety: ${reason}`);
  }

  const bq = getClient();

  const options = {
    query:             sql,
    location:          process.env.GCP_LOCATION || 'US',
    maximumBytesBilled: String((MAX_ROWS) * 1024 * 1024), // loose cap
    timeoutMs:         TIMEOUT_MS,
    jobPrefix:         'claude_app_',
  };

  logger.info('Running BigQuery job...');
  const [rows] = await bq.query(options);

  if (rows.length > MAX_ROWS) {
    logger.warn(`Result truncated to ${MAX_ROWS} rows`);
    return rows.slice(0, MAX_ROWS).map(serializeRow);
  }

  return rows.map(serializeRow);
}

/**
 * Serialize a BigQuery row — converts BigQuery-specific types
 * (e.g. BigQueryDate, BigQueryTimestamp) to plain JS values.
 */
function serializeRow(row) {
  const out = {};
  for (const [key, val] of Object.entries(row)) {
    if (val === null || val === undefined) {
      out[key] = null;
    } else if (typeof val === 'object' && val.value !== undefined) {
      // BigQueryDate, BigQueryTimestamp, BigQueryTime
      out[key] = val.value;
    } else {
      out[key] = val;
    }
  }
  return out;
}

module.exports = { run };
