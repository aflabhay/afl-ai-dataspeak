/**
 * src/utils/cost.estimator.js
 * ────────────────────────────
 * Estimates the BigQuery scan cost of a query using a dry run.
 *
 * BigQuery pricing (on-demand): $6.25 per TB scanned
 * Dry runs process no data and are always free.
 */

const { getClient } = require('../bigquery/bigquery.client');
const logger = require('./logger');

const COST_PER_TB   = 6.25;   // USD per TB
const BYTES_PER_GB  = 1024 ** 3;
const BYTES_PER_TB  = 1024 ** 4;

/**
 * Estimate cost of a BigQuery query using a dry run.
 *
 * @param {string} sql
 * @returns {Promise<{
 *   estimatedBytes: number,
 *   estimatedGB:    number,
 *   estimatedTB:    number,
 *   estimatedCost:  string,   // formatted "$X.XX"
 *   withinLimit:    boolean,
 * }>}
 */
async function estimate(sql) {
  const bq = getClient();

  try {
    const [job] = await bq.createQueryJob({
      query:    sql,
      dryRun:   true,
      location: process.env.GCP_LOCATION || 'US',
    });

    const bytesProcessed = parseInt(
      job.metadata?.statistics?.totalBytesProcessed || '0',
      10
    );

    const estimatedGB   = bytesProcessed / BYTES_PER_GB;
    const estimatedTB   = bytesProcessed / BYTES_PER_TB;
    const estimatedCost = (estimatedTB * COST_PER_TB).toFixed(4);
    const maxGB         = parseFloat(process.env.MAX_BQ_SCAN_GB || '5');

    logger.info(`Dry run: ${estimatedGB.toFixed(3)} GB | $${estimatedCost}`);

    return {
      estimatedBytes: bytesProcessed,
      estimatedGB,
      estimatedTB,
      estimatedCost: `$${estimatedCost}`,
      withinLimit:   estimatedGB <= maxGB,
    };

  } catch (err) {
    // If dry run fails (e.g. table not found), return a safe default
    logger.warn(`Cost estimation failed: ${err.message}`);
    return {
      estimatedBytes: 0,
      estimatedGB:    0,
      estimatedTB:    0,
      estimatedCost:  '$0.0000',
      withinLimit:    true,
      error:          err.message,
    };
  }
}

module.exports = { estimate };
