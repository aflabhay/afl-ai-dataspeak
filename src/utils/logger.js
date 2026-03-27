/**
 * src/utils/logger.js
 * ────────────────────
 * Application-wide Winston logger.
 *
 * - Development: coloured console output
 * - Production:  JSON format (structured for Cloud Logging / Log Analytics)
 */

const winston = require('winston');

const isProd = process.env.NODE_ENV === 'production';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: isProd
    ? winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      )
    : winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
          return `${timestamp} [${level}] ${message}${metaStr}`;
        })
      ),
  transports: [
    new winston.transports.Console(),
  ],
});

module.exports = logger;
