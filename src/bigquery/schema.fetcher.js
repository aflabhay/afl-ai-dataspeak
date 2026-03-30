/**
 * src/bigquery/schema.fetcher.js
 * ──────────────────────────────
 * Fetches table schemas from BigQuery to give Claude context
 * about available columns and data types.
 *
 * Schema is cached per dataset to avoid repeated API calls
 * within the same process lifetime.
 */

const { getClient }    = require('./bigquery.client');
const columnMetadata   = require('./column.metadata');
const { enrichColumns } = require('../utils/column.enricher');
const logger           = require('../utils/logger');

// In-memory cache: key = "projectId.dataset", value = schema array
const schemaCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Fetch schema for specific tables (or all tables) in a dataset.
 *
 * When table names are provided, calls table.getMetadata() directly for each —
 * never calls getTables() on the full dataset, which can fail on large datasets
 * due to oversized API responses.
 *
 * @param {string}   dataset — BigQuery dataset ID (e.g. "DCOE_Production")
 * @param {string[]} tables  — specific table names to fetch ([] = all)
 * @returns {Promise<Array<{ tableName, columns }>>}
 */
async function fetchSchema(dataset, tables = []) {
  const bq        = getClient();
  const projectId = process.env.GCP_PROJECT_ID;

  // ── Fast path: specific tables requested ─────────────────────────────────
  // Skip getTables() entirely — fetch each table's metadata directly.
  // Each table is cached individually so repeated questions are free.
  if (tables.length > 0) {
    const results = await Promise.all(tables.map(name => fetchTableSchema(bq, dataset, name, projectId)));
    return results.filter(Boolean);
  }

  // ── Slow path: all tables in dataset (rare — only when no tables specified) ─
  const cacheKey = `${projectId}.${dataset}.__all__`;
  if (schemaCache.has(cacheKey)) {
    const { schema, fetchedAt } = schemaCache.get(cacheKey);
    if (Date.now() - fetchedAt < CACHE_TTL_MS) {
      logger.info(`Full schema cache hit for ${dataset}`);
      return schema;
    }
  }

  logger.info(`Fetching full dataset schema for: ${dataset}`);
  try {
    const [allTables] = await bq.dataset(dataset).getTables();
    const chunks      = chunkArray(allTables, 5);
    const schema      = [];

    for (const chunk of chunks) {
      const metas = await Promise.all(
        chunk.map(t => fetchTableSchema(bq, dataset, t.id, projectId))
      );
      schema.push(...metas.filter(Boolean));
    }

    schemaCache.set(cacheKey, { schema, fetchedAt: Date.now() });
    logger.info(`Cached full schema: ${schema.length} tables in ${dataset}`);
    return schema;

  } catch (err) {
    logger.error(`Failed to fetch BigQuery schema: ${err.message}`);
    throw new Error(`Could not fetch schema for dataset "${dataset}": ${err.message}`);
  }
}

/**
 * Fetch and cache metadata for a single table by name.
 *
 * Column samples come from t_aida_column_metadata (written once per TTL period,
 * default 24h) — not from scanning the source table on every request.
 *
 * Flow:
 *  1. In-memory schema cache hit  → return immediately
 *  2. BigQuery metadata table hit → attach stored samples, return
 *  3. Metadata stale/missing      → scan source LIMIT 200 (one-time), save to metadata table
 *
 * @returns {Promise<{ tableName, columns }|null>}
 */
async function fetchTableSchema(bq, dataset, tableName, projectId) {
  const cacheKey = `${projectId}.${dataset}.${tableName}`;

  if (schemaCache.has(cacheKey)) {
    const { entry, fetchedAt } = schemaCache.get(cacheKey);
    if (Date.now() - fetchedAt < CACHE_TTL_MS) {
      logger.info(`Table schema cache hit: ${tableName}`);
      return entry;
    }
  }

  try {
    // ── Fetch column definitions from INFORMATION_SCHEMA ──────────────────
    // More reliable than getMetadata() — returns data_type, ordinal_position,
    // and any column-level descriptions set in BigQuery.
    const [infoRows] = await bq.query({
      query: `
        SELECT column_name, data_type, is_nullable
        FROM \`${projectId}.${dataset}.INFORMATION_SCHEMA.COLUMNS\`
        WHERE table_name = @tableName
        ORDER BY ordinal_position
      `,
      params: { tableName },
    });

    if (!infoRows || infoRows.length === 0) {
      logger.warn(`INFORMATION_SCHEMA returned no columns for ${tableName}`);
      return null;
    }

    const columns = infoRows.map(row => ({
      name:        row.column_name,
      type:        row.data_type,
      mode:        row.is_nullable === 'YES' ? 'NULLABLE' : 'REQUIRED',
      description: '',
    }));

    // ── Get sample values from metadata table (cheap) ─────────────────────
    let metaMap = await columnMetadata.getSamples(dataset, tableName);

    if (!metaMap) {
      // Metadata missing or stale — scan source table once and persist
      logger.info(`First time seeing ${tableName} — sampling source table (one-time scan)`);
      const rawSamples = await sampleSourceTable(bq, projectId, dataset, tableName, columns);
      await columnMetadata.saveSamples(dataset, tableName, columns, rawSamples);

      // Enrich with AI-generated business descriptions in the background.
      // Non-blocking — descriptions appear from the next query onwards.
      const columnsWithSamples = columns.map(c => ({ ...c, samples: rawSamples[c.name] || [] }));
      enrichColumns(tableName, columnsWithSamples)
        .then(descriptions => columnMetadata.updateDescriptions(dataset, tableName, descriptions))
        .catch(err => logger.warn(`Background enrichment failed for ${tableName}: ${err.message}`));

      // Build metaMap from freshly fetched samples
      metaMap = {};
      for (const col of columns) {
        metaMap[col.name] = { samples: rawSamples[col.name] || [], description: '', dataType: col.type };
      }
    }

    // ── Merge metadata into columns ───────────────────────────────────────
    const columnsWithMeta = columns.map(col => {
      const m = metaMap[col.name] || {};
      return {
        ...col,
        samples:     m.samples     || [],
        // business_description from metadata table overrides the BQ field description
        description: m.description || col.description,
      };
    });

    const entry = { tableName, columns: columnsWithMeta };
    schemaCache.set(cacheKey, { entry, fetchedAt: Date.now() });
    logger.info(`Schema ready: ${tableName} (${columns.length} columns)`);
    return entry;

  } catch (err) {
    logger.warn(`Could not fetch schema for table ${tableName}: ${err.message}`);
    return null;
  }
}

/**
 * Scan the source table (LIMIT 200) to collect distinct sample values for
 * STRING columns. Called at most once per TTL period — results are persisted
 * in t_aida_column_metadata so future calls skip this entirely.
 *
 * @returns {Promise<Record<string, string[]>>}  { colName: ['val1', 'val2', ...] }
 */
async function sampleSourceTable(bq, projectId, dataset, tableName, columns) {
  if (columns.length === 0) return {};

  const NUMERIC_TYPES = new Set(['INTEGER', 'INT64', 'FLOAT', 'FLOAT64', 'NUMERIC', 'BIGNUMERIC', 'DECIMAL', 'BIGDECIMAL']);

  // Numeric columns are selected as-is (values stay as numbers).
  // All other types (STRING, DATE, TIMESTAMP, BOOL, BYTES, GEOGRAPHY, JSON, etc.)
  // are cast to STRING so the BQ client returns a plain readable value.
  const selectList = columns.map(c =>
    NUMERIC_TYPES.has(c.type)
      ? `\`${c.name}\``
      : `SAFE_CAST(\`${c.name}\` AS STRING) AS \`${c.name}\``
  ).join(', ');

  try {
    const [rows] = await bq.query({
      query: `SELECT ${selectList} FROM \`${projectId}.${dataset}.${tableName}\` LIMIT 200`,
    });

    const samples = {};
    for (const col of columns) {
      const limit = 3;  // 3 distinct samples per column

      const raw    = rows.map(r => r[col.name]).filter(v => v != null && v !== '');
      const unique = [...new Map(raw.map(v => [String(v), v])).values()].slice(0, limit);
      // Map keyed by String(v) deduplicates while preserving the original type
      // — numeric columns keep their JS number type in the stored JSON array.

      if (unique.length > 0) samples[col.name] = unique;
    }
    return samples;
  } catch (err) {
    logger.warn(`Source table sampling failed for ${tableName} (non-fatal): ${err.message}`);
    return {};
  }
}

/**
 * List all table names in a dataset (no column metadata — very cheap call).
 * Result is cached separately with the same TTL.
 *
 * @param {string} dataset
 * @returns {Promise<string[]>}
 */
async function listTables(dataset) {
  const bq        = getClient();
  const projectId = process.env.GCP_PROJECT_ID;
  const cacheKey  = `${projectId}.${dataset}.__tableNames`;

  if (schemaCache.has(cacheKey)) {
    const { names, fetchedAt } = schemaCache.get(cacheKey);
    if (Date.now() - fetchedAt < CACHE_TTL_MS) return names;
  }

  // fields param limits response payload — avoids JSON parse errors on large datasets
  const [allTables] = await bq.dataset(dataset).getTables({ fields: 'tables/tableReference/tableId' });
  const names = allTables.map(t => t.id).filter(Boolean);
  schemaCache.set(cacheKey, { names, fetchedAt: Date.now() });
  logger.info(`Listed ${names.length} tables in dataset ${dataset}`);
  return names;
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

module.exports = { fetchSchema, listTables, listDatasets };
