/**
 * src/utils/result.cache.js
 * ──────────────────────────
 * In-memory TTL cache for BigQuery/Fabric query results.
 *
 * Cache key: SHA-256 of (normalised SQL + source).
 * Same SQL against the same source always returns the same data
 * within the TTL window — zero database cost on repeat queries.
 *
 * Production note: Replace the Map with Redis for multi-instance deployments.
 *   const redis = require('ioredis'); const client = new redis(REDIS_URL);
 *
 * Usage:
 *   const resultCache = require('./result.cache');
 *   const hit = resultCache.get(sql, source);
 *   if (hit) return hit;
 *   const rows = await runQuery(sql);
 *   resultCache.set(sql, source, rows);
 */

const { createHash } = require('crypto');
const logger = require('./logger');

const TTL_MS      = parseInt(process.env.RESULT_CACHE_TTL_MS  || String(30 * 60 * 1000)); // 30 min default
const MAX_ENTRIES = parseInt(process.env.RESULT_CACHE_MAX_ENTRIES || '200');

// Map<cacheKey, { rows, cachedAt }>
const store = new Map();

/**
 * Build a stable cache key from SQL + source.
 * Normalises whitespace so minor formatting differences are ignored.
 */
function buildKey(sql, source) {
  const normalised = sql.replace(/\s+/g, ' ').trim().toLowerCase() + '|' + source;
  return createHash('sha256').update(normalised).digest('hex').slice(0, 16);
}

/**
 * Retrieve cached rows, or null if missing / expired.
 *
 * @param {string} sql
 * @param {string} source — "bigquery" | "fabric"
 * @returns {object[]|null}
 */
function get(sql, source) {
  const key   = buildKey(sql, source);
  const entry = store.get(key);

  if (!entry) return null;

  if (Date.now() - entry.cachedAt > TTL_MS) {
    store.delete(key);
    return null;
  }

  logger.info(`Result cache HIT (key=${key}, rows=${entry.rows.length})`);
  return entry.rows;
}

/**
 * Store rows in the cache.
 *
 * @param {string}   sql
 * @param {string}   source
 * @param {object[]} rows
 */
function set(sql, source, rows) {
  // Evict oldest entries when at capacity
  if (store.size >= MAX_ENTRIES) {
    const oldestKey = store.keys().next().value;
    store.delete(oldestKey);
  }

  const key = buildKey(sql, source);
  store.set(key, { rows, cachedAt: Date.now() });
  logger.info(`Result cache SET (key=${key}, rows=${rows.length}, ttl=${TTL_MS / 1000}s)`);
}

/** Current cache stats — useful for the /health endpoint. */
function stats() {
  let live = 0;
  const now = Date.now();
  for (const entry of store.values()) {
    if (now - entry.cachedAt <= TTL_MS) live++;
  }
  return { total: store.size, live, ttlMs: TTL_MS, maxEntries: MAX_ENTRIES };
}

/** Manually flush the entire cache (e.g. after schema changes). */
function flush() {
  store.clear();
  logger.info('Result cache flushed');
}

module.exports = { get, set, stats, flush };
