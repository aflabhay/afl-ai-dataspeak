/**
 * src/bigquery/schema.fetcher.js
 * ──────────────────────────────
 * Fetches table schemas from BigQuery to give Claude context
 * about available columns and data types.
 *
 * Schema is cached per dataset to avoid repeated API calls
 * within the same process lifetime.
 */

const { getClient } = require('./bigquery.client');
const logger = require('../utils/logger');

// In-memory cache: key = "projectId.dataset", value = schema array
const schemaCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Fetch schema for specific tables (or all tables) in a dataset.
 *
 * @param {string}   dataset — BigQuery dataset ID (e.g. "DCOE_Production")
 * @param {string[]} tables  — specific table names to fetch ([] = all)
 * @returns {Promise<Array<{ tableName, columns }>>}
 */
async function fetchSchema(dataset, tables = []) {
  const bq        = getClient();
  const projectId = process.env.GCP_PROJECT_ID;
  const cacheKey  = `${projectId}.${dataset}`;

  // Return cached schema if still fresh
  if (schemaCache.has(cacheKey)) {
    const { schema, fetchedAt } = schemaCache.get(cacheKey);
    if (Date.now() - fetchedAt < CACHE_TTL_MS) {
      logger.info(`Schema cache hit for ${cacheKey}`);
      return filterByTables(schema, tables);
    }
  }

  logger.info(`Fetching schema from BigQuery for dataset: ${dataset}`);

  try {
    const [allTables] = await bq.dataset(dataset).getTables();

    // Fetch metadata for each table in parallel (limit concurrency to 10)
    const chunks = chunkArray(allTables, 10);
    const schema = [];

    for (const chunk of chunks) {
      const metas = await Promise.all(
        chunk.map(async (table) => {
          try {
            const [meta] = await table.getMetadata();
            const columns = (meta.schema?.fields || []).map(field => ({
              name:        field.name,
              type:        field.type,
              mode:        field.mode,
              description: field.description || '',
            }));
            return { tableName: table.id, columns };
          } catch {
            return { tableName: table.id, columns: [] };
          }
        })
      );
      schema.push(...metas);
    }

    // Cache the result
    schemaCache.set(cacheKey, { schema, fetchedAt: Date.now() });
    logger.info(`Cached schema for ${schema.length} tables in ${dataset}`);

    return filterByTables(schema, tables);

  } catch (err) {
    logger.error(`Failed to fetch BigQuery schema: ${err.message}`);
    throw new Error(`Could not fetch schema for dataset "${dataset}": ${err.message}`);
  }
}

/**
 * List all datasets in the project.
 * @param {string} [filterDataset] — optional name filter
 * @returns {Promise<string[]>}
 */
async function listDatasets(filterDataset) {
  const bq = getClient();
  const [datasets] = await bq.getDatasets();
  const names = datasets.map(d => d.id);
  return filterDataset ? names.filter(n => n.includes(filterDataset)) : names;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function filterByTables(schema, tables) {
  if (!tables || tables.length === 0) return schema;
  return schema.filter(s => tables.includes(s.tableName));
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

module.exports = { fetchSchema, listDatasets };
