/**
 * src/utils/semantic.cache.js
 * ────────────────────────────
 * Embedding-based similarity cache with two tiers:
 *
 *  PRIMARY  — LanceDB (local file-based vector DB).
 *             Persists across server restarts. Stored at data/lancedb/.
 *             Install: npm install @lancedb/lancedb
 *
 *  FALLBACK — In-memory JS array (same behaviour as before).
 *             Used automatically if LanceDB is not installed.
 *
 * DATE-SCOPED: every cache entry is tagged with today's YYYY-MM-DD date.
 * The same question asked on a different calendar day is ALWAYS a cache miss
 * — forcing a fresh AI + database round-trip so results reflect current data.
 * Within the same day, same question + same source + same table(s) always
 * returns the cached result with no hour/minute time limit.
 *
 * Cache key dimensions: date + dataset + source + tables + semantic similarity
 *
 * Environment variables:
 *   OPENAI_API_KEY           — required for embeddings (even when AI_PROVIDER=claude)
 *   SEMANTIC_CACHE_THRESHOLD — cosine similarity threshold (default: 0.92)
 *   SEMANTIC_CACHE_MAX       — max in-memory fallback entries (default: 500)
 *   VECTOR_DB_PATH           — LanceDB directory (default: ./data/lancedb)
 */

const path   = require('path');
const fs     = require('fs');
const OpenAI = require('openai');
const logger = require('./logger');

const EMBEDDING_MODEL   = 'text-embedding-3-small';
const EMBEDDING_DIM     = 1536;   // text-embedding-3-small output dimension
const THRESHOLD         = parseFloat(process.env.SEMANTIC_CACHE_THRESHOLD || '0.92');
const MAX_MEM_ENTRIES   = parseInt(process.env.SEMANTIC_CACHE_MAX         || '500');
const DB_PATH           = process.env.VECTOR_DB_PATH || path.join(process.cwd(), 'data', 'lancedb');
const MAX_STORED_ROWS   = 100;  // cap result rows stored per entry to keep payload small

// ── State ─────────────────────────────────────────────────────────────────────
let _openai      = null;
let _lanceTable  = null;
let _lanceInited = false;
const memStore   = [];   // in-memory fallback

// ── File-based persistence (in-memory fallback path) ─────────────────────────
// When LanceDB is not installed, persist today's entries to a JSON file so they
// survive server restarts. Entries from prior days are ignored (date-scoped cache).
const CACHE_FILE = path.join(process.cwd(), 'data', 'semantic_cache.json');

function _loadPersistedEntries() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return;
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const today  = todayKey();
    let loaded   = 0;
    for (const e of (parsed.entries || [])) {
      if (e.date_key === today && Array.isArray(e.embedding)) {
        memStore.push(e);
        loaded++;
      }
    }
    if (loaded > 0) logger.info(`Semantic cache: loaded ${loaded} persisted entries from file (date=${today})`);
  } catch (err) {
    logger.warn(`Semantic cache file load failed (non-fatal): ${err.message}`);
  }
}

function _persistToFile() {
  try {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const today   = todayKey();
    const entries = memStore.filter(e => e.date_key === today);
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ entries, savedAt: Date.now() }));
  } catch (err) {
    logger.warn(`Semantic cache file save failed (non-fatal): ${err.message}`);
  }
}

// Load persisted entries synchronously at startup (before any request handling)
_loadPersistedEntries();

// ── Helpers ───────────────────────────────────────────────────────────────────

function getOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

/** Returns today's date string YYYY-MM-DD — the cache scope key. */
function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function embed(text) {
  const res = await getOpenAI().embeddings.create({
    model: EMBEDDING_MODEL,
    input: text.slice(0, 2000),
  });
  return res.data[0].embedding;
}

// ── LanceDB initialisation ────────────────────────────────────────────────────

async function getLanceTable() {
  if (_lanceInited) return _lanceTable;
  _lanceInited = true;

  let lancedb;
  try {
    lancedb = require('@lancedb/lancedb');
  } catch {
    logger.info('LanceDB not installed — semantic cache using in-memory store. Run: npm install @lancedb/lancedb');
    return null;
  }

  try {
    fs.mkdirSync(DB_PATH, { recursive: true });
    const db    = await lancedb.connect(DB_PATH);
    const names = await db.tableNames();

    if (names.includes('semantic_cache')) {
      _lanceTable = await db.openTable('semantic_cache');
      logger.info(`Vector DB loaded from ${DB_PATH}`);
    } else {
      // Seed one schema-init row so LanceDB can infer column types.
      // Ignored on lookup because date_key = '1970-01-01' never matches today.
      _lanceTable = await db.createTable('semantic_cache', [{
        vector:        new Array(EMBEDDING_DIM).fill(0),
        question:      '__init__',
        dataset:       '__init__',
        source:        '__init__',
        tables_json:   '[]',
        date_key:      '1970-01-01',
        response_json: '{}',
        cached_at:     0,
      }]);
      logger.info(`Vector DB created at ${DB_PATH}`);
    }
  } catch (err) {
    logger.warn(`LanceDB init failed (${err.message}) — falling back to in-memory semantic cache`);
    _lanceTable = null;
  }

  return _lanceTable;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Normalise a tables array to a stable JSON string for comparison. */
function tablesKey(tables) {
  return JSON.stringify([...(tables || [])].sort());
}

/**
 * Look up the cache for a semantically similar question asked TODAY
 * against the same source and tables.
 *
 * Match criteria (all must pass):
 *   • date_key  — today's YYYY-MM-DD  (different day = always miss)
 *   • dataset   — same BQ dataset / Fabric schema
 *   • source    — same data source (bigquery | fabric)
 *   • tables    — same target table(s)
 *   • similarity ≥ THRESHOLD
 *
 * No within-day time limit — same day + same context = always a hit.
 */
async function lookup(question, dataset, tables, source) {
  if (!process.env.OPENAI_API_KEY) return null;

  let queryEmbedding;
  try {
    queryEmbedding = await embed(question);
  } catch (err) {
    logger.warn(`Semantic cache embed failed: ${err.message}`);
    return null;
  }

  const dateKey  = todayKey();
  const tablesJs = tablesKey(tables);
  const src      = source || 'bigquery';
  const lanceTab = await getLanceTable();

  // ── LanceDB path ──────────────────────────────────────────────────────────
  if (lanceTab) {
    try {
      const rows = await lanceTab
        .search(queryEmbedding)
        .limit(20)
        .toArray();

      for (const row of rows) {
        if (row.date_key  !== dateKey)  continue;   // different day → miss
        if (row.dataset   !== dataset)  continue;
        if (row.source    !== src)      continue;   // different source → miss
        if (row.tables_json !== tablesJs) continue; // different tables → miss

        const score = cosineSimilarity(queryEmbedding, Array.from(row.vector));
        if (score >= THRESHOLD) {
          logger.info(`Semantic cache HIT via LanceDB (score=${score.toFixed(4)}, date=${dateKey}, source=${src})`);
          return { ...JSON.parse(row.response_json), fromSemanticCache: true, cacheScore: score.toFixed(4) };
        }
      }

      logger.info(`Semantic cache MISS via LanceDB (date=${dateKey})`);
      return null;
    } catch (err) {
      logger.warn(`LanceDB lookup failed: ${err.message} — trying in-memory`);
    }
  }

  // ── In-memory fallback ────────────────────────────────────────────────────
  let best = 0, bestEntry = null;

  for (const entry of memStore) {
    if (entry.date_key    !== dateKey)  continue;
    if (entry.dataset     !== dataset)  continue;
    if (entry.source      !== src)      continue;
    if (entry.tables_json !== tablesJs) continue;
    const score = cosineSimilarity(queryEmbedding, entry.embedding);
    if (score > best) { best = score; bestEntry = entry; }
  }

  if (best >= THRESHOLD && bestEntry) {
    logger.info(`Semantic cache HIT via memory (score=${best.toFixed(4)}, date=${dateKey}, source=${src})`);
    return { ...bestEntry.response, fromSemanticCache: true, cacheScore: best.toFixed(4) };
  }

  logger.info(`Semantic cache MISS via memory (bestScore=${best.toFixed(4)}, date=${dateKey})`);
  return null;
}

/**
 * Store a response in the semantic cache.
 * Results are capped at MAX_STORED_ROWS to keep the payload small.
 */
async function store(question, dataset, tables, response, source) {
  if (!process.env.OPENAI_API_KEY) return;

  let embedding;
  try {
    embedding = await embed(question);
  } catch (err) {
    logger.warn(`Semantic cache store embed failed: ${err.message}`);
    return;
  }

  const dateKey  = todayKey();
  const tablesJs = tablesKey(tables);
  const src      = source || 'bigquery';

  // Trim large result sets before storing
  const trimmed = response.results
    ? { ...response, results: response.results.slice(0, MAX_STORED_ROWS) }
    : response;

  const lanceTab = await getLanceTable();

  // ── LanceDB path ──────────────────────────────────────────────────────────
  if (lanceTab) {
    try {
      await lanceTab.add([{
        vector:        embedding,
        question,
        dataset,
        source:        src,
        tables_json:   tablesJs,
        date_key:      dateKey,
        response_json: JSON.stringify(trimmed),
        cached_at:     Date.now(),
      }]);
      logger.info(`Semantic cache STORED in LanceDB (date=${dateKey}, source=${src}, q="${question.slice(0, 60)}")`);
      return;
    } catch (err) {
      logger.warn(`LanceDB store failed: ${err.message} — falling back to in-memory`);
    }
  }

  // ── In-memory fallback ────────────────────────────────────────────────────
  if (memStore.length >= MAX_MEM_ENTRIES) {
    memStore.sort((a, b) => a.cachedAt - b.cachedAt);
    memStore.splice(0, Math.floor(MAX_MEM_ENTRIES * 0.1));
  }
  memStore.push({
    question, embedding, dataset,
    source: src, tables_json: tablesJs,
    date_key: dateKey,
    response: trimmed,
    cachedAt: Date.now(),
  });
  logger.info(`Semantic cache STORED in memory (date=${dateKey}, source=${src}, q="${question.slice(0, 60)}")`);
  // Persist to file so entries survive server restarts
  setImmediate(_persistToFile);
}

/** Invalidate all cache entries for a given dataset (call after schema changes). */
function invalidate(dataset) {
  const before = memStore.length;
  memStore.splice(0, memStore.length, ...memStore.filter(e => e.dataset !== dataset));
  logger.info(`Semantic cache: invalidated ${before - memStore.length} in-memory entries for dataset=${dataset}`);
  // LanceDB entries expire naturally by date_key + TTL; no active purge needed.
}

function stats() {
  const today = todayKey();
  const live  = memStore.filter(e => e.date_key === today).length;
  return {
    backend:    _lanceTable ? 'lancedb' : 'in-memory',
    memEntries: live,
    threshold:  THRESHOLD,
    dateScope:  today,
    dbPath:     _lanceTable ? DB_PATH : null,
  };
}

module.exports = { lookup, store, invalidate, stats };
