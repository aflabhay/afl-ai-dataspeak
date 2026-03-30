/**
 * src/bigquery/history.writer.js
 * ────────────────────────────────
 * Saves every Q&A turn to BigQuery for persistent chat history.
 *
 * Dataset: GCP_FEEDBACK_DATASET (default: "AFL_AI_DataSpeak")
 * Table:   chat_history
 *
 * Auto-creates the table on first use. Append-only — rows are never
 * modified; history is rebuilt by querying in timestamp order.
 */

const { randomUUID } = require('crypto');
const { getClient }  = require('./bigquery.client');
const logger         = require('../utils/logger');

const HISTORY_DATASET = process.env.GCP_FEEDBACK_DATASET || 'AFL_AI';
const HISTORY_TABLE   = 't_aida_chat_history';

const TABLE_SCHEMA = {
  fields: [
    { name: 'id',           type: 'STRING',    mode: 'REQUIRED' },
    { name: 'session_id',   type: 'STRING',    mode: 'REQUIRED' },
    { name: 'timestamp',    type: 'TIMESTAMP', mode: 'REQUIRED' },
    { name: 'user_id',      type: 'STRING',    mode: 'NULLABLE' },  // Azure AD Object ID
    { name: 'user_name',    type: 'STRING',    mode: 'NULLABLE' },
    { name: 'user_email',   type: 'STRING',    mode: 'NULLABLE' },
    { name: 'question',     type: 'STRING',    mode: 'REQUIRED' },
    { name: 'sql',          type: 'STRING',    mode: 'NULLABLE' },
    { name: 'explanation',  type: 'STRING',    mode: 'NULLABLE' },
    { name: 'ai_provider',  type: 'STRING',    mode: 'NULLABLE' },
    { name: 'tables_used',  type: 'STRING',    mode: 'NULLABLE' },  // JSON array string
    { name: 'source',       type: 'STRING',    mode: 'NULLABLE' },
    { name: 'dataset_name', type: 'STRING',    mode: 'NULLABLE' },
    { name: 'row_count',    type: 'INTEGER',   mode: 'NULLABLE' },
    { name: 'execution_ms',       type: 'INTEGER', mode: 'NULLABLE' },
    { name: 'intent',             type: 'STRING',  mode: 'NULLABLE' },
    { name: 'chart_config',       type: 'STRING',  mode: 'NULLABLE' },  // JSON chart config
    { name: 'cost_info',          type: 'STRING',  mode: 'NULLABLE' },  // JSON {estimatedGB, estimatedCost}
    { name: 'ai_cost',            type: 'STRING',  mode: 'NULLABLE' },  // JSON {model, estimatedCost, ...}
    { name: 'confidence_score',   type: 'INTEGER', mode: 'NULLABLE' },
    { name: 'confidence_reason',  type: 'STRING',  mode: 'NULLABLE' },
  ],
};

let _tableEnsured = false;

async function ensureTable() {
  if (_tableEnsured) return;

  const bq = getClient();

  const dataset = bq.dataset(HISTORY_DATASET);
  const [dsExists] = await dataset.exists();
  if (!dsExists) {
    await dataset.create({ location: process.env.GCP_LOCATION || 'US' });
    logger.info(`Created BigQuery dataset: ${HISTORY_DATASET}`);
  }

  const table = dataset.table(HISTORY_TABLE);
  const [tblExists] = await table.exists();
  if (!tblExists) {
    await table.create({ schema: TABLE_SCHEMA });
    logger.info(`Created BigQuery table: ${HISTORY_DATASET}.${HISTORY_TABLE}`);
  } else {
    // Migrate: add user_id / user_name / user_email if missing (tables created before auth)
    try {
      const [meta] = await table.getMetadata();
      const existing = new Set(meta.schema.fields.map(f => f.name));
      const toAdd = [];
      if (!existing.has('user_id'))           toAdd.push({ name: 'user_id',           type: 'STRING',  mode: 'NULLABLE' });
      if (!existing.has('user_name'))         toAdd.push({ name: 'user_name',         type: 'STRING',  mode: 'NULLABLE' });
      if (!existing.has('user_email'))        toAdd.push({ name: 'user_email',        type: 'STRING',  mode: 'NULLABLE' });
      if (!existing.has('chart_config'))      toAdd.push({ name: 'chart_config',      type: 'STRING',  mode: 'NULLABLE' });
      if (!existing.has('cost_info'))         toAdd.push({ name: 'cost_info',         type: 'STRING',  mode: 'NULLABLE' });
      if (!existing.has('ai_cost'))           toAdd.push({ name: 'ai_cost',           type: 'STRING',  mode: 'NULLABLE' });
      if (!existing.has('confidence_score'))  toAdd.push({ name: 'confidence_score',  type: 'INTEGER', mode: 'NULLABLE' });
      if (!existing.has('confidence_reason')) toAdd.push({ name: 'confidence_reason', type: 'STRING',  mode: 'NULLABLE' });
      if (toAdd.length > 0) {
        meta.schema.fields.push(...toAdd);
        await table.setMetadata({ schema: meta.schema });
        logger.info(`Migrated chat_history: added ${toAdd.map(f => f.name).join(', ')}`);
      }
    } catch (err) {
      logger.warn(`Schema migration check failed (non-fatal): ${err.message}`);
    }
  }

  _tableEnsured = true;
}

/**
 * Save one Q&A turn to chat_history.
 * Returns the generated turn ID so it can be linked to feedback later.
 *
 * @param {object} turn
 * @returns {Promise<string>} turn ID
 */
async function saveTurn(turn) {
  await ensureTable();

  const id  = turn.id || randomUUID();
  const bq  = getClient();
  const row = {
    id,
    session_id:   turn.sessionId,
    timestamp:    new Date().toISOString(),
    user_id:      turn.userId       || null,
    user_name:    turn.userName     || null,
    user_email:   turn.userEmail    || null,
    question:     turn.question,
    sql:          turn.sql          || null,
    explanation:  turn.explanation  || null,
    ai_provider:  turn.aiProvider   || null,
    tables_used:  turn.tablesUsed   ? JSON.stringify(turn.tablesUsed) : null,
    source:       turn.source       || null,
    dataset_name: turn.dataset      || null,
    row_count:          turn.rowCount          ?? null,
    execution_ms:       turn.executionMs       ?? null,
    intent:             turn.intent            || null,
    chart_config:       turn.chart             ? JSON.stringify(turn.chart) : null,
    cost_info:          turn.costInfo          ? JSON.stringify(turn.costInfo) : null,
    ai_cost:            turn.aiCost            ? JSON.stringify(turn.aiCost)   : null,
    confidence_score:   turn.confidenceScore   ?? null,
    confidence_reason:  turn.confidenceReason  || null,
  };

  await bq.dataset(HISTORY_DATASET).table(HISTORY_TABLE).insert([row]);
  logger.info(`Chat turn saved: ${id} for session: ${turn.sessionId}`);
  return id;
}

module.exports = { saveTurn };
