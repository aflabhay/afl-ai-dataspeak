/**
 * src/api/history.routes.js
 * ──────────────────────────
 * GET /api/history?sessionId=xxx&limit=100
 *
 * Returns all chat turns for a session, joined with the latest feedback
 * per turn (BigQuery append-only → latest feedback row wins via ROW_NUMBER).
 *
 * Response:
 *   { turns: [ { id, timestamp, question, sql, explanation, ai_provider,
 *                tables_used, source, dataset_name, row_count, execution_ms,
 *                intent, feedback_rating, feedback_comment, feedback_id } ] }
 */

const express = require('express');
const router  = express.Router();

const { getClient } = require('../bigquery/bigquery.client');
const logger        = require('../utils/logger');

const DATASET = process.env.GCP_FEEDBACK_DATASET || 'AFL_AI';

router.get('/', async (req, res, next) => {
  const { sessionId } = req.query;
  const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);

  if (!sessionId || sessionId.trim() === '') {
    return res.status(400).json({ error: '`sessionId` query param is required.' });
  }

  try {
    const bq   = getClient();
    const user = req.user || {};

    // Azure AD users (OID = UUID format): filter by user_id across all sessions
    // Guest / local dev users: filter by sessionId (scoped to this browser)
    //   also accept rows where user_id is null (saved before auth was added)
    const isAzureUser = !!user.id
      && user.id !== 'local-dev-user'
      && !user.id.startsWith('guest_');

    const params      = isAzureUser
      ? { userId: user.id, limit }
      : { sessionId: sessionId.trim(), userId: user.id || '', limit };

    const whereClause = isAzureUser
      ? `WHERE h.user_id = @userId`
      : `WHERE h.session_id = @sessionId
         AND (h.user_id IS NULL OR h.user_id = '' OR h.user_id = @userId)`;

    let rows;
    try {
      const [result] = await bq.query({
        query: `
          SELECT
            h.id,
            h.session_id,
            h.timestamp,
            h.question,
            h.sql,
            h.explanation,
            h.ai_provider,
            h.tables_used,
            h.source,
            h.dataset_name,
            h.row_count,
            h.execution_ms,
            h.intent,
            h.chart_config,
            h.cost_info,
            h.ai_cost,
            h.confidence_score,
            h.confidence_reason,
            h.user_name,
            h.user_email,
            f.rating       AS feedback_rating,
            f.user_comment AS feedback_comment,
            f.id           AS feedback_id
          FROM \`${DATASET}.t_aida_chat_history\` h
          LEFT JOIN (
            SELECT turn_id, rating, user_comment, id,
              ROW_NUMBER() OVER (PARTITION BY turn_id ORDER BY timestamp DESC) AS rn
            FROM \`${DATASET}.t_aida_query_feedback\`
            WHERE turn_id IS NOT NULL
          ) f ON f.turn_id = h.id AND f.rn = 1
          ${whereClause}
          ORDER BY h.timestamp ASC
          LIMIT @limit
        `,
        params,
      });
      rows = result;
    } catch (joinErr) {
      logger.warn(`History join failed (${joinErr.message}) — returning history without feedback`);
      const [result] = await bq.query({
        query: `
          SELECT
            id, session_id, timestamp, question, sql, explanation,
            ai_provider, tables_used, source, dataset_name,
            row_count, execution_ms, intent, chart_config,
            NULL AS feedback_rating,
            NULL AS feedback_comment,
            NULL AS feedback_id
          FROM \`${DATASET}.t_aida_chat_history\` h
          ${whereClause}
          ORDER BY h.timestamp ASC
          LIMIT @limit
        `,
        params,
      });
      rows = result;
    }

    // BigQuery TIMESTAMP fields come back as { value: '2024-01-15T...' } objects.
    // Normalise to plain ISO strings so the frontend can parse them directly.
    const turns = rows.map(r => ({
      ...r,
      timestamp: r.timestamp?.value ?? r.timestamp ?? null,
    }));

    logger.info(`History loaded: ${turns.length} turns for session ${sessionId.slice(0, 20)}`);
    return res.json({ turns });

  } catch (err) {
    // t_aida_chat_history table may not exist yet (no messages sent yet)
    if (err.message && err.message.includes('Not found')) {
      return res.json({ turns: [] });
    }
    logger.error(`History fetch failed: ${err.message}`);
    next(err);
  }
});

module.exports = router;
