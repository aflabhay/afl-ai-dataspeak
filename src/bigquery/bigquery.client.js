/**
 * src/bigquery/bigquery.client.js
 * ────────────────────────────────
 * Singleton BigQuery client.
 *
 * Authentication options (in priority order):
 *  1. GOOGLE_APPLICATION_CREDENTIALS env var pointing to service account JSON
 *  2. Application Default Credentials (gcloud auth application-default login)
 *
 * The client is created once and reused across all requests.
 */

const { BigQuery } = require('@google-cloud/bigquery');
const logger = require('../utils/logger');

let _client = null;

/**
 * Get (or create) the BigQuery client singleton.
 * @returns {BigQuery}
 */
function getClient() {
  if (_client) return _client;

  const projectId = process.env.GCP_PROJECT_ID;

  if (!projectId) {
    throw new Error('GCP_PROJECT_ID environment variable is required for BigQuery.');
  }

  logger.info(`Initialising BigQuery client for project: ${projectId}`);

  _client = new BigQuery({
    projectId,
    // keyFilename is picked up automatically from GOOGLE_APPLICATION_CREDENTIALS
    // or falls back to Application Default Credentials
  });

  return _client;
}

module.exports = { getClient };
