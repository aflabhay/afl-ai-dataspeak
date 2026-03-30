/**
 * server.js
 * ─────────
 * Express application entry point.
 * Wires together middleware, routes, and starts the HTTP server.
 */

require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const compression = require('compression');
const rateLimit   = require('express-rate-limit');

const chatRoutes      = require('./src/api/chat.routes');
const schemaRoutes    = require('./src/api/schema.routes');
const healthRoutes    = require('./src/api/health.routes');
const feedbackRoutes  = require('./src/api/feedback.routes');
const historyRoutes   = require('./src/api/history.routes');
const questionsRoutes = require('./src/api/questions.routes');
const { requireAuth } = require('./src/middleware/auth.middleware');
const errorHandler    = require('./src/utils/error.handler');
const logger          = require('./src/utils/logger');

const app  = express();
const PORT = process.env.PORT || 4000;

// ── Security & Performance Middleware ────────────────────────────────────────
app.use(helmet());
app.use(compression());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Guest-Id', 'X-Guest-Name', 'X-Guest-Email'],
}));
app.use(express.json({ limit: '1mb' }));

// ── Rate Limiting ────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute
  max: 30,               // 30 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — please slow down.' },
});
app.use('/api/', limiter);

// ── Request Logging ──────────────────────────────────────────────────────────
app.use((req, _res, next) => {
  logger.info(`${req.method} ${req.path}`, { ip: req.ip });
  next();
});

// ── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/health',    healthRoutes);           // health check — no auth needed
app.use('/api/questions', questionsRoutes);         // question menu — no auth needed
app.use('/api/chat',      requireAuth, chatRoutes);
app.use('/api/schema',    requireAuth, schemaRoutes);
app.use('/api/feedback',  requireAuth, feedbackRoutes);
app.use('/api/history',   requireAuth, historyRoutes);

// ── Global Error Handler ─────────────────────────────────────────────────────
app.use(errorHandler);

// ── Start Server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`🚀 AIDA server running on http://localhost:${PORT}`);
  logger.info(`📊 BigQuery project: ${process.env.GCP_PROJECT_ID}`);
  logger.info(`🗄  AIDA dataset: ${process.env.GCP_FEEDBACK_DATASET || 'AIDA'}`);

  // Questions are now dynamically generated per-table from column metadata — no seeding needed
});

module.exports = app; // exported for testing
