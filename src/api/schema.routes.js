/**
 * src/api/schema.routes.js
 * ────────────────────────
 * GET /api/schema/:source
 *
 * Returns available datasets and tables for the given source.
 * Used by the frontend to populate dropdowns.
 *
 * Params:
 *   source  — "bigquery" | "fabric"
 *
 * Query params:
 *   dataset — (optional) filter to a specific dataset/schema
 */

const express = require('express');
const router  = express.Router();

const bqSchemaFetcher = require('../bigquery/schema.fetcher');
const fbSchemaFetcher = require('../fabric/schema.fetcher');
const columnMetadata  = require('../bigquery/column.metadata');
const logger          = require('../utils/logger');

/**
 * GET /api/schema/metadata?dataset=X&table=Y&source=bigquery
 * Returns column metadata (names, types, descriptions, sample values) for a table.
 * Used by the sidebar "View Columns" button.
 */
router.get('/metadata', async (req, res, next) => {
  const { dataset, source = 'bigquery' } = req.query;

  // Accept both `table` (single) and `tables` (comma-separated) params
  const rawTables = (req.query.tables || req.query.table || '').trim();
  const tableList = rawTables.split(',').map(t => t.trim()).filter(Boolean);

  if (!dataset || tableList.length === 0) {
    return res.status(400).json({ error: '`dataset` and `table` (or `tables`) are required.' });
  }

  try {
    const fetcher = source === 'fabric' ? fbSchemaFetcher : bqSchemaFetcher;
    const results = [];

    for (const table of tableList) {
      // Try the metadata table first (has enriched descriptions + sample values)
      const metaMap = await columnMetadata.getSamples(dataset, table);
      if (metaMap && Object.keys(metaMap).length > 0) {
        const columns = Object.entries(metaMap).map(([name, meta]) => ({
          name,
          type:        meta.dataType    || 'STRING',
          description: meta.description || '',
          samples:     meta.samples     || [],
        }));
        results.push({ tableName: table, columns, fromMetadata: true });
        continue;
      }

      // Metadata not found — fetch schema (triggers one-time sampling + enrichment)
      const schema = await fetcher.fetchSchema(dataset, [table]);
      const tableSchema = schema?.[0];
      if (!tableSchema) {
        results.push({ tableName: table, columns: [], fromMetadata: false });
        continue;
      }
      const hasSamples = tableSchema.columns.some(c => c.samples && c.samples.length > 0);
      results.push({ tableName: table, columns: tableSchema.columns, fromMetadata: hasSamples });
    }

    // Single-table callers get the original shape; multi-table callers get `tables` array
    if (tableList.length === 1) {
      return res.json({ ...results[0], dataset, source });
    }
    return res.json({ tables: results, dataset, source });

  } catch (err) {
    next(err);
  }
});

router.get('/:source', async (req, res, next) => {
  const { source } = req.params;
  const { dataset } = req.query;

  if (!['bigquery', 'fabric'].includes(source)) {
    return res.status(400).json({ error: 'source must be "bigquery" or "fabric"' });
  }

  try {
    logger.info(`Fetching schema list for source=${source}`);

    let schema;
    if (source === 'bigquery') {
      schema = await bqSchemaFetcher.listDatasets(dataset);
    } else {
      schema = await fbSchemaFetcher.listSchemas(dataset);
    }

    return res.json({ source, schema });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/schema/refresh
 * Force-invalidate column metadata cache for a specific table.
 * Next query on that table will re-sample the source and update t_aida_column_metadata.
 *
 * Body: { dataset, table }
 */
router.post('/refresh', async (req, res, next) => {
  const { dataset, table } = req.body;
  if (!dataset || !table) {
    return res.status(400).json({ error: '`dataset` and `table` are required.' });
  }
  try {
    await columnMetadata.invalidate(dataset, table);
    logger.info(`Schema cache invalidated for ${dataset}.${table} by ${req.user?.email || 'unknown'}`);
    return res.json({ ok: true, message: `Cache cleared for ${dataset}.${table}. Next query will re-sample.` });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
