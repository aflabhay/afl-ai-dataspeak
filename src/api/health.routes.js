/**
 * src/api/health.routes.js
 * ─────────────────────────
 * GET /api/health
 *
 * Simple health check used by load balancers, CI/CD pipelines,
 * and uptime monitors to verify the service is running.
 */

const express = require('express');
const router  = express.Router();

router.get('/', (_req, res) => {
  res.json({
    status:    'ok',
    timestamp: new Date().toISOString(),
    uptime:    process.uptime(),
    version:   process.env.npm_package_version || '1.0.0',
    env:       process.env.NODE_ENV || 'development',
  });
});

module.exports = router;
