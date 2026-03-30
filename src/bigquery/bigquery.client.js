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
const { readFileSync } = require('fs');
const { resolve }     = require('path');
const logger          = require('../utils/logger');

let _client = null;

/**
 * Get (or create) the BigQuery client singleton.
 *
 * Loads the service account JSON ourselves and passes it as a `credentials`
 * object — bypasses google-auth-library's ReadStream-based file parser which
 * can fail with a JSON parse error on certain Node.js versions/environments.
 *
 * @returns {BigQuery}
 */
function getClient() {
  if (_client) return _client;

  const projectId = process.env.GCP_PROJECT_ID;
  if (!projectId) throw new Error('GCP_PROJECT_ID environment variable is required for BigQuery.');

  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  let clientOptions = { projectId };

  if (keyPath) {
    try {
      const absPath    = resolve(process.cwd(), keyPath);
      const raw        = readFileSync(absPath, 'utf8').trim();
      const credentials = JSON.parse(raw);
      clientOptions.credentials = credentials;
      logger.info(`BigQuery auth: loaded credentials from ${absPath} (${credentials.client_email})`);
    } catch (err) {
      logger.warn(`BigQuery auth: could not load key file (${err.message}) — falling back to ADC`);
      // Fall back to Application Default Credentials
    }
  }

  logger.info(`Initialising BigQuery client for project: ${projectId}`);
  _client = new BigQuery(clientOptions);

  return _client;
}

module.exports = { getClient };
