/**
 * src/fabric/schema.fetcher.js
 * ─────────────────────────────
 * Fetches table schemas from Microsoft Fabric Data Warehouse
 * using INFORMATION_SCHEMA queries.
 */

const { getPool } = require('./fabric.client');
const logger = require('../utils/logger');

const schemaCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Fetch schema for specific tables (or all tables) in a schema.
 *
 * @param {string}   schemaName — e.g. "dcoe_gcp_prd"
 * @param {string[]} tables     — specific table names to fetch ([] = all)
 * @returns {Promise<Array<{ tableName, columns }>>}
 */
async function fetchSchema(schemaName, tables = []) {
  const cacheKey = `fabric.${schemaName}`;

  if (schemaCache.has(cacheKey)) {
    const { schema, fetchedAt } = schemaCache.get(cacheKey);
    if (Date.now() - fetchedAt < CACHE_TTL_MS) {
      logger.info(`Fabric schema cache hit for ${cacheKey}`);
      return filterByTables(schema, tables);
    }
  }

  logger.info(`Fetching Fabric schema for schema: ${schemaName}`);

  const pool = await getPool();

  const request = pool.request().input('schema', schemaName);

  let tableFilter = '';
  if (tables.length > 0) {
    const params = tables.map((t, i) => {
      request.input(`t${i}`, t);
      return `@t${i}`;
    });
    tableFilter = `AND c.TABLE_NAME IN (${params.join(',')})`;
  }

  const query = `
    SELECT
        c.TABLE_NAME,
        c.COLUMN_NAME,
        c.DATA_TYPE,
        c.IS_NULLABLE,
        ep.value AS COLUMN_DESCRIPTION
    FROM INFORMATION_SCHEMA.COLUMNS c
    LEFT JOIN sys.extended_properties ep
        ON ep.major_id  = OBJECT_ID(c.TABLE_SCHEMA + '.' + c.TABLE_NAME)
        AND ep.minor_id = c.ORDINAL_POSITION
        AND ep.name     = 'MS_Description'
    WHERE c.TABLE_SCHEMA = @schema
    ${tableFilter}
    ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION
  `;

  const result = await request.query(query);

  // Group columns by table
  const tableMap = new Map();
  for (const row of result.recordset) {
    if (!tableMap.has(row.TABLE_NAME)) {
      tableMap.set(row.TABLE_NAME, []);
    }
    tableMap.get(row.TABLE_NAME).push({
      name:        row.COLUMN_NAME,
      type:        row.DATA_TYPE,
      nullable:    row.IS_NULLABLE === 'YES',
      description: row.COLUMN_DESCRIPTION || '',
    });
  }

  const schema = Array.from(tableMap.entries()).map(([tableName, columns]) => ({
    tableName,
    columns,
  }));

  schemaCache.set(cacheKey, { schema, fetchedAt: Date.now() });
  logger.info(`Cached Fabric schema for ${schema.length} tables in ${schemaName}`);

  return filterByTables(schema, tables);
}

/**
 * List all table names in a schema (no column metadata — very cheap call).
 *
 * @param {string} schemaName
 * @returns {Promise<string[]>}
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
    .query(`SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = @schema ORDER BY TABLE_NAME`);

  const names = result.recordset.map(r => r.TABLE_NAME);
  schemaCache.set(cacheKey, { names, fetchedAt: Date.now() });
  logger.info(`Listed ${names.length} tables in Fabric schema ${schemaName}`);
  return names;
}

/**
 * List available schemas in the Fabric warehouse.
 * @returns {Promise<string[]>}
 */
async function listSchemas() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT DISTINCT TABLE_SCHEMA
    FROM INFORMATION_SCHEMA.TABLES
    ORDER BY TABLE_SCHEMA
  `);
  return result.recordset.map(r => r.TABLE_SCHEMA);
}

function filterByTables(schema, tables) {
  if (!tables || tables.length === 0) return schema;
  return schema.filter(s => tables.includes(s.tableName));
}

module.exports = { fetchSchema, listTables, listSchemas };
