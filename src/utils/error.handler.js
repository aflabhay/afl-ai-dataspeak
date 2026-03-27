/**
 * src/utils/error.handler.js
 * ───────────────────────────
 * Express global error handler middleware.
 * Must be registered AFTER all routes (4 arguments = error handler).
 *
 * Returns a consistent JSON error envelope:
 *   { error: string, details?: string, stack?: string }
 */

const logger = require('./logger');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || err.status || 500;
  const isProd     = process.env.NODE_ENV === 'production';

  logger.error(`${req.method} ${req.path} → ${statusCode}: ${err.message}`, {
    stack: err.stack,
  });

  const body = {
    error: err.message || 'An unexpected error occurred.',
  };

  // Include stack trace in development only
  if (!isProd && err.stack) {
    body.stack = err.stack;
  }

  return res.status(statusCode).json(body);
}

module.exports = errorHandler;
