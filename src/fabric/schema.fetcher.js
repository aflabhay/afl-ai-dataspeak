/**
 * src/fabric/schema.fetcher.js
 * ─────────────────────────────
 * Fetches table schemas from Microsoft Fabric Data Warehouse.
 *
 * Mirrors the BigQuery schema fetcher flow:
 *   1. Check in-memory schema cache           — instant
 *   2. Check BigQuery t_aida_table_column_metadata — cheap BQ read
 *   3. If missing → sample Fabric (SELECT TOP 200) — one-time scan
 *   4. Save samples to BigQuery metadata table
 *   5. Trigger background AI column enrichment
 *
 * BigQuery is the metadata store for BOTH sources — Fabric doesn't have
 * an equivalent persistent store for column descriptions/samples.
 */

const { getPool }        = require('./fabric.client');
const columnMetadata     = require('../bigquery/column.metadata');
const { enrichColumns }  = require('../utils/column.enricher');
const logger             = require('../utils/logger');

const schemaCache  = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ── Schema fetch ──────────────────────────────────────────────────────────────

/**
 * Fetch schema for specific tables (or all tables) in a Fabric schema.
 * Triggers one-time metadata sampling + AI enrichment on first encounter.
 *
 * @param {string}   schemaName — e.g. "dbo" or "dcoe_gcp_prd"
 * @param {string[]} tables     — specific table names ([] = all)
 * @returns {Promise<Array<{ tableName, columns }>>}
 */
async function fetchSchema(schemaName, tables = []) {
  if (tables.length > 0) {
    const results = await Promise.all(
      tables.map(name => fetchTableSchema(schemaName, name))
    );
    return results.filter(Boolean);
  }

  // All tables in schema
  const cacheKey = `fabric.${schemaName}.__all__`;
  if (schemaCache.has(cacheKey)) {
    const { schema, fetchedAt } = schemaCache.get(cacheKey);
    if (Date.now() - fetchedAt < CACHE_TTL_MS) return schema;
  }

  const allTables = await listTables(schemaName);
  const schema    = [];
  for (const name of allTables) {
    const entry = await fetchTableSchema(schemaName, name);
    if (entry) schema.push(entry);
  }

  schemaCache.set(cacheKey, { schema, fetchedAt: Date.now() });
  return schema;
}

/**
 * Fetch and cache metadata for a single Fabric table.
 * Triggers one-time sampling + enrichment when first encountered.
 */
async function fetchTableSchema(schemaName, tableName) {
  const cacheKey = `fabric.${schemaName}.${tableName}`;

  if (schemaCache.has(cacheKey)) {
    const { entry, fetchedAt } = schemaCache.get(cacheKey);
    if (Date.now() - fetchedAt < CACHE_TTL_MS) return entry;
  }

  try {
    const pool    = await getPool();
    const columns = await fetchColumnDefinitions(pool, schemaName, tableName);
    if (!columns || columns.length === 0) return null;

    // ── Check BigQuery metadata table (cheap) ───────────────────────────────
    let metaMap = await columnMetadata.getSamples(schemaName, tableName);

    if (!metaMap) {
      // First time seeing this table — sample Fabric and persist to BigQuery
      logger.info(`First time seeing Fabric table ${schemaName}.${tableName} — sampling (one-time)`);
      const rawSamples = await sampleFabricTable(pool, schemaName, tableName, columns);
      await columnMetadata.saveSamples(schemaName, tableName, columns, rawSamples);

      // AI enrichment in background — doesn't block the response
      const columnsWithSamples = columns.map(c => ({ ...c, samples: rawSamples[c.name] || [] }));
      enrichColumns(tableName, columnsWithSamples)
        .then(descs => columnMetadata.updateDescriptions(schemaName, tableName, descs))
        .catch(err  => logger.warn(`Background enrichment failed for ${tableName}: ${err.message}`));

      // Build metaMap from fresh samples
      metaMap = {};
      for (const col of columns) {
        metaMap[col.name] = { samples: rawSamples[col.name] || [], description: '', dataType: col.type };
      }
    }

    // Merge metadata into column definitions
    const columnsWithMeta = columns.map(col => {
      const m = metaMap[col.name] || {};
      return {
        ...col,
        samples:     m.samples     || [],
        description: m.description || col.description || '',
      };
    });

    const entry = { tableName, columns: columnsWithMeta };
    schemaCache.set(cacheKey, { entry, fetchedAt: Date.now() });
    logger.info(`Fabric schema loaded: ${tableName} (${columnsWithMeta.length} columns)`);
    return entry;

  } catch (err) {
    logger.warn(`fetchTableSchema failed for ${schemaName}.${tableName}: ${err.message}`);
    return null;
  }
}

// ── Column definitions from INFORMATION_SCHEMA ────────────────────────────────

async function fetchColumnDefinitions(pool, schemaName, tableName) {
  const request = pool.request()
    .input('schema', schemaName)
    .input('table',  tableName);

  const result = await request.query(`
    SELECT
      c.COLUMN_NAME,
      c.DATA_TYPE,
      c.IS_NULLABLE,
      CAST(ep.value AS NVARCHAR(MAX)) AS COLUMN_DESCRIPTION
    FROM INFORMATION_SCHEMA.COLUMNS c
    LEFT JOIN sys.extended_properties ep
      ON ep.major_id  = OBJECT_ID(c.TABLE_SCHEMA + '.' + c.TABLE_NAME)
      AND ep.minor_id = c.ORDINAL_POSITION
      AND ep.name     = 'MS_Description'
    WHERE c.TABLE_SCHEMA = @schema
      AND c.TABLE_NAME   = @table
    ORDER BY c.ORDINAL_POSITION
  `);

  return (result.recordset || []).map(row => ({
    name:        row.COLUMN_NAME,
    type:        row.DATA_TYPE,
    nullable:    row.IS_NULLABLE === 'YES',
    description: row.COLUMN_DESCRIPTION || '',
  }));
}

// ── Data sampling ─────────────────────────────────────────────────────────────

/**
 * Sample up to 200 rows from a Fabric table and extract distinct non-null
 * values per column (up to 10 per column).
 *
 * Uses SELECT TOP 200 — no full table scan, Fabric optimizer uses row-group
 * pruning so this is fast even on large tables.
 *
 * @returns {Record<string, string[]>}  { colName: ['val1', 'val2', ...] }
 */
async function sampleFabricTable(pool, schemaName, tableName, columns) {
  const samplesMap = {};

  try {
    // Quote identifiers to handle reserved words and mixed case
    const colList = columns
      .map(c => `[${c.name.replace(/]/g, ']]')}]`)
      .join(', ');

    const result = await pool.request().query(`
      SELECT TOP 200 ${colList}
      FROM [${schemaName}].[${tableName}]
    `);

    const rows = result.recordset || [];

    for (const col of columns) {
      const seen   = new Set();
      const values = [];
      for (const row of rows) {
        const v = row[col.name];
        if (v !== null && v !== undefined && v !== '') {
          const str = String(v).trim().slice(0, 100); // cap long strings
          if (!seen.has(str)) {
            seen.add(str);
            values.push(str);
            if (values.length >= 10) break;
          }
        }
      }
      samplesMap[col.name] = values;
    }

    logger.info(`Sampled ${rows.length} rows from Fabric ${schemaName}.${tableName}`);
  } catch (err) {
    logger.warn(`Fabric sampling failed for ${tableName}: ${err.message}`);
    // Return empty samples — column definitions still work
    for (const col of columns) samplesMap[col.name] = [];
  }

  return samplesMap;
}

// ── List tables / schemas ──────────────────────────────────────────────────────

/**
 * List all table names in a Fabric schema (no column metadata — cheap call).
 */
async function listTables(schemaName) {
  const cacheKey = `fabric.${schemaName}.__tableNames`;
  if (schemaCache.has(cacheKey)) {
    const { names, fetchedAt } = schemaCache.get(cacheKey);
    if (Date.now() - fetchedAt < CACHE_TTL_MS) return names;
  }

  const pool   = await getPool();
  const result = await pool.request()
    .input('schema', schemaName)
    .query(`
      SELECT TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = @schema
        AND TABLE_TYPE   = 'BASE TABLE'
      ORDER BY TABLE_NAME
    `);

  const names = result.recordset.map(r => r.TABLE_NAME);
  schemaCache.set(cacheKey, { names, fetchedAt: Date.now() });
  logger.info(`Listed ${names.length} tables in Fabric schema ${schemaName}`);
  return names;
}

/**
 * List available schemas in the Fabric warehouse.
 */
async function listSchemas() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT DISTINCT TABLE_SCHEMA
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_TYPE = 'BASE TABLE'
    ORDER BY TABLE_SCHEMA
  `);
  return result.recordset.map(r => r.TABLE_SCHEMA);
}

module.exports = { fetchSchema, listTables, listSchemas };
