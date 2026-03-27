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
const logger          = require('../utils/logger');

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

module.exports = router;
