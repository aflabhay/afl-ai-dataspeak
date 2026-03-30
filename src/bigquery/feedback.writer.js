/**
 * src/bigquery/feedback.writer.js
 * ────────────────────────────────
 * Inserts a single feedback row into BigQuery via the streaming insert API.
 *
 * Table is auto-created on first insert if it doesn't exist.
 * Dataset: GCP_FEEDBACK_DATASET (default: "AFL_AI_DataSpeak")
 * Table:   query_feedback
 */

const { randomUUID } = require('crypto');
const { getClient }  = require('./bigquery.client');
const logger         = require('../utils/logger');

const FEEDBACK_DATASET = process.env.GCP_FEEDBACK_DATASET || 'AFL_AI';
const FEEDBACK_TABLE   = 't_aida_query_feedback';

const TABLE_SCHEMA = {
  fields: [
    { name: 'id',           type: 'STRING',    mode: 'REQUIRED' },
    { name: 'timestamp',    type: 'TIMESTAMP',  mode: 'REQUIRED' },
    { name: 'turn_id',      type: 'STRING',    mode: 'NULLABLE' },  // links to chat_history.id
    { name: 'user_id',      type: 'STRING',    mode: 'NULLABLE' },  // Azure AD Object ID
    { name: 'user_name',    type: 'STRING',    mode: 'NULLABLE' },
    { name: 'user_email',   type: 'STRING',    mode: 'NULLABLE' },
    { name: 'session_id',   type: 'STRING',    mode: 'NULLABLE' },
    { name: 'question',     type: 'STRING',    mode: 'REQUIRED' },
    { name: 'generated_sql',type: 'STRING',    mode: 'NULLABLE' },
    { name: 'explanation',  type: 'STRING',    mode: 'NULLABLE' },
    { name: 'ai_provider',  type: 'STRING',    mode: 'NULLABLE' },
    { name: 'tables_used',  type: 'STRING',    mode: 'NULLABLE' },  // JSON array string
    { name: 'source',       type: 'STRING',    mode: 'NULLABLE' },  // bigquery | fabric
    { name: 'dataset',      type: 'STRING',    mode: 'NULLABLE' },
    { name: 'row_count',    type: 'INTEGER',   mode: 'NULLABLE' },
    { name: 'execution_ms', type: 'INTEGER',   mode: 'NULLABLE' },
    { name: 'bq_cost',      type: 'STRING',    mode: 'NULLABLE' },
    { name: 'ai_cost',      type: 'STRING',    mode: 'NULLABLE' },
    { name: 'rating',       type: 'STRING',    mode: 'REQUIRED' },  // up | down
    { name: 'user_comment', type: 'STRING',    mode: 'NULLABLE' },
  ],
};

let _tableEnsured = false;

/**
 * Ensure the feedback dataset and table exist, creating them if needed.
 */
async function ensureTable() {
  if (_tableEnsured) return;

  const bq = getClient();

  // Create dataset if missing
  const dataset = bq.dataset(FEEDBACK_DATASET);
  const [dsExists] = await dataset.exists();
  if (!dsExists) {
    await dataset.create({ location: process.env.GCP_LOCATION || 'US' });
    logger.info(`Created BigQuery dataset: ${FEEDBACK_DATASET}`);
  }

  // Create table if missing; otherwise migrate schema if turn_id column is absent
  const table = dataset.table(FEEDBACK_TABLE);
  const [tblExists] = await table.exists();
  if (!tblExists) {
    await table.create({ schema: TABLE_SCHEMA });
    logger.info(`Created BigQuery table: ${FEEDBACK_DATASET}.${FEEDBACK_TABLE}`);
  } else {
    // Migrate: add new columns if the table was created before this feature
    try {
      const [meta] = await table.getMetadata();
      const existing = new Set(meta.schema.fields.map(f => f.name));
      const toAdd = [];
      if (!existing.has('turn_id'))    toAdd.push({ name: 'turn_id',    type: 'STRING', mode: 'NULLABLE' });
      if (!existing.has('user_id'))    toAdd.push({ name: 'user_id',    type: 'STRING', mode: 'NULLABLE' });
      if (!existing.has('user_name'))  toAdd.push({ name: 'user_name',  type: 'STRING', mode: 'NULLABLE' });
      if (!existing.has('user_email')) toAdd.push({ name: 'user_email', type: 'STRING', mode: 'NULLABLE' });
      if (toAdd.length > 0) {
        meta.schema.fields.push(...toAdd);
        await table.setMetadata({ schema: meta.schema });
        logger.info(`Migrated ${FEEDBACK_TABLE}: added ${toAdd.map(f => f.name).join(', ')}`);
      }
    } catch (err) {
      logger.warn(`Schema migration check failed (non-fatal): ${err.message}`);
    }
  }

  _tableEnsured = true;
}

/**
 * Insert one feedback record into BigQuery.
 *
 * @param {object} feedback
 */
async function insertFeedback(feedback) {
  await ensureTable();

  const bq  = getClient();
  const row = {
    id:            randomUUID(),
    timestamp:     new Date().toISOString(),
    turn_id:       feedback.turnId       || null,
    user_id:       feedback.userId       || null,
    user_name:     feedback.userName     || null,
    user_email:    feedback.userEmail    || null,
    session_id:    feedback.sessionId    || null,
    question:      feedback.question,
    generated_sql: feedback.sql          || null,
    explanation:   feedback.explanation  || null,
    ai_provider:   feedback.aiProvider   || null,
    tables_used:   feedback.tablesUsed   ? JSON.stringify(feedback.tablesUsed) : null,
    source:        feedback.source       || null,
    dataset:       feedback.dataset      || null,
    row_count:     feedback.rowCount     ?? null,
    execution_ms:  feedback.executionMs  ?? null,
    bq_cost:       feedback.bqCost       || null,
    ai_cost:       feedback.aiCost       || null,
    rating:        feedback.rating,
    user_comment:  feedback.userComment  || null,
  };

  await bq.dataset(FEEDBACK_DATASET).table(FEEDBACK_TABLE).insert([row]);
  logger.info(`Feedback saved: ${feedback.rating} for question: "${feedback.question.slice(0, 60)}"`);
}

module.exports = { insertFeedback };
