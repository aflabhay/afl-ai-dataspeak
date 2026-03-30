/**
 * src/bigquery/column.metadata.js
 * ─────────────────────────────────
 * Persistent store for column-level schema documentation.
 *
 * Table: AFL_AI.t_aida_table_column_metadata
 *
 * Stores sample values and business descriptions for every column in
 * every queried table. This avoids scanning source tables on every request
 * just to discover what values a STRING column contains.
 *
 * Sampling strategy — scan once, store forever:
 *   1. Check in-memory cache → instant, no BQ
 *   2. Check t_aida_table_column_metadata → cheap (<1KB BQ read)
 *   3. If missing → scan source LIMIT 200 (one time only), save to metadata table
 *
 * Source tables are scanned exactly once per column set.
 * To re-scan after schema/data changes, call POST /api/schema/refresh.
 *
 * Manual enrichment:
 *   Data analysts can set `business_description` directly in BigQuery
 *   for any column. Those descriptions flow into every AI prompt automatically.
 *
 *   UPDATE `AFL_AI.t_aida_table_column_metadata`
 *   SET business_description = 'Day of the week as a full name (e.g. Monday)'
 *   WHERE table_name = 't_capillary_rfm_cohort_gold_layer' AND column_name = 'weekday'
 */

const { getClient }  = require('./bigquery.client');
const logger         = require('../utils/logger');

const META_DATASET = process.env.GCP_FEEDBACK_DATASET || 'AFL_AI';
const META_TABLE   = 't_aida_table_column_metadata';

const TABLE_SCHEMA = {
  fields: [
    { name: 'dataset_name',         type: 'STRING',    mode: 'REQUIRED' },
    { name: 'table_name',           type: 'STRING',    mode: 'REQUIRED' },
    { name: 'column_name',          type: 'STRING',    mode: 'REQUIRED' },
    { name: 'data_type',            type: 'STRING',    mode: 'REQUIRED' },
    { name: 'sample_values',        type: 'STRING',    mode: 'NULLABLE' }, // JSON array of strings
    { name: 'business_description', type: 'STRING',    mode: 'NULLABLE' }, // manually editable in BQ
    { name: 'last_sampled_at',      type: 'TIMESTAMP', mode: 'NULLABLE' }, // when source was last scanned
    { name: 'updated_at',           type: 'TIMESTAMP', mode: 'REQUIRED' },
  ],
};

let _tableEnsured = false;

// In-memory cache: key = "dataset.tableName" → { samplesMap, fetchedAt }
const memCache = new Map();
const MEM_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ── Table bootstrap ───────────────────────────────────────────────────────────

async function ensureTable() {
  if (_tableEnsured) return;
  const bq = getClient();

  const ds = bq.dataset(META_DATASET);
  const [dsExists] = await ds.exists();
  if (!dsExists) await ds.create({ location: process.env.GCP_LOCATION || 'US' });

  const tbl = ds.table(META_TABLE);
  const [tblExists] = await tbl.exists();
  if (!tblExists) {
    await tbl.create({ schema: TABLE_SCHEMA });
    logger.info(`Created ${META_DATASET}.${META_TABLE}`);
  }

  _tableEnsured = true;
}

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * Get stored column samples for a table.
 * Returns the samples map if rows exist, or null if this table has never been sampled.
 *
 * @param {string} dataset
 * @param {string} tableName
 * @returns {Promise<Record<string,string[]>|null>}
 */
async function getSamples(dataset, tableName) {
  // 1. In-memory cache hit
  const memKey = `${dataset}.${tableName}`;
  const mem    = memCache.get(memKey);
  if (mem && Date.now() - mem.fetchedAt < MEM_TTL_MS) {
    logger.info(`Column metadata mem-cache hit: ${tableName}`);
    return mem.samplesMap;
  }

  await ensureTable();
  const bq = getClient();

  try {
    // 2. One row per column — simple SELECT, no dedup needed
    const [rows] = await bq.query({
      query: `
        SELECT column_name, data_type, sample_values, business_description, last_sampled_at
        FROM \`${META_DATASET}.${META_TABLE}\`
        WHERE dataset_name = @dataset AND table_name = @tableName
      `,
      params: { dataset, tableName },
    });

    if (!rows || rows.length === 0) return null;

    // Build samples map — rows exist means already sampled, always use them
    const samplesMap = {};
    for (const row of rows) {
      samplesMap[row.column_name] = {
        samples:     row.sample_values ? JSON.parse(row.sample_values) : [],
        description: row.business_description || '',
        dataType:    row.data_type,
      };
    }

    // Warm in-memory cache
    memCache.set(memKey, { samplesMap, fetchedAt: Date.now() });
    logger.info(`Column metadata loaded from BQ for ${tableName} (${rows.length} columns)`);
    return samplesMap;

  } catch (err) {
    // Table might not exist yet on very first run
    if (err.message?.includes('Not found')) return null;
    logger.warn(`Column metadata read failed for ${tableName}: ${err.message}`);
    return null;
  }
}

/**
 * Save column samples to the metadata table (append-only insert).
 * ROW_NUMBER on read always picks the latest row, so this acts as an upsert.
 *
 * @param {string}   dataset
 * @param {string}   tableName
 * @param {object[]} columns      — [{ name, type }]
 * @param {object}   samplesMap   — { colName: string[] }
 */
async function saveSamples(dataset, tableName, columns, samplesMap) {
  if (columns.length === 0) return;
  await ensureTable();

  const bq  = getClient();
  const now = new Date().toISOString();

  // Use DML INSERT (not streaming API) so rows are immediately available for
  // UPDATE in updateDescriptions(). Streaming inserts land in a buffer where
  // DML is blocked until BigQuery flushes it (can take minutes to hours).
  try {
    for (const col of columns) {
      const samples = samplesMap[col.name] ? JSON.stringify(samplesMap[col.name]) : null;
      await bq.query({
        query: `
          INSERT INTO \`${META_DATASET}.${META_TABLE}\`
            (dataset_name, table_name, column_name, data_type, sample_values,
             business_description, last_sampled_at, updated_at)
          VALUES
            (@dataset, @tableName, @columnName, @dataType, @samples,
             NULL, @now, @now)
        `,
        params: {
          dataset,
          tableName,
          columnName:  col.name,
          dataType:    col.type,
          samples,
          now,
        },
      });
    }

    // Warm in-memory cache
    const newMap = {};
    for (const col of columns) {
      newMap[col.name] = { samples: samplesMap[col.name] || [], description: '', dataType: col.type };
    }
    memCache.set(`${dataset}.${tableName}`, { samplesMap: newMap, fetchedAt: Date.now() });
    logger.info(`Column metadata saved for ${dataset}.${tableName} (${columns.length} columns)`);
  } catch (err) {
    logger.warn(`Column metadata save failed for ${tableName}: ${err.message}`);
  }
}

/**
 * Save AI-generated business descriptions to the metadata table.
 * Only updates rows where business_description is currently NULL or empty —
 * manual descriptions set directly in BigQuery are never overwritten.
 *
 * @param {string}                  dataset
 * @param {string}                  tableName
 * @param {Record<string, string>}  descriptions  — { columnName: 'description' }
 */
async function updateDescriptions(dataset, tableName, descriptions) {
  const entries = Object.entries(descriptions).filter(([, v]) => v && v.trim());
  if (entries.length === 0) return;

  await ensureTable();
  const bq = getClient();

  for (const [columnName, description] of entries) {
    try {
      await bq.query({
        query: `
          UPDATE \`${META_DATASET}.${META_TABLE}\`
          SET business_description = @description,
              updated_at           = CURRENT_TIMESTAMP()
          WHERE dataset_name = @dataset
            AND table_name   = @tableName
            AND column_name  = @columnName
            AND (business_description IS NULL OR TRIM(business_description) = '')
        `,
        params: { description: description.trim(), dataset, tableName, columnName },
      });
    } catch (err) {
      logger.warn(`Description update failed for ${tableName}.${columnName}: ${err.message}`);
    }
  }

  // Invalidate in-memory cache so next read picks up the new descriptions
  memCache.delete(`${dataset}.${tableName}`);
  logger.info(`Business descriptions saved for ${dataset}.${tableName} (${entries.length} columns)`);
}

/**
 * Delete stored metadata for a table so it gets re-sampled on next query.
 * Called from POST /api/schema/refresh when schema or data has changed.
 */
async function invalidate(dataset, tableName) {
  memCache.delete(`${dataset}.${tableName}`);

  try {
    await ensureTable();
    const bq = getClient();
    await bq.query({
      query:  `DELETE FROM \`${META_DATASET}.${META_TABLE}\` WHERE dataset_name = @dataset AND table_name = @tableName`,
      params: { dataset, tableName },
    });
    logger.info(`Column metadata deleted for ${dataset}.${tableName} — will re-sample on next query`);
  } catch (err) {
    logger.warn(`Column metadata delete failed for ${tableName}: ${err.message}`);
  }
}

module.exports = { getSamples, saveSamples, updateDescriptions, invalidate };
