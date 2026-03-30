/**
 * src/api/feedback.routes.js
 * ───────────────────────────
 * POST /api/feedback
 *
 * Receives a thumbs-up or thumbs-down rating for an AI-generated answer
 * and stores the full context in BigQuery for quality analysis.
 *
 * Request body:
 *   {
 *     rating       : "up" | "down"       — required
 *     question     : string              — the user's original question
 *     sql          : string              — generated SQL
 *     explanation  : string              — AI explanation
 *     aiProvider   : string              — "GPT-4o-mini" | "Claude"
 *     tablesUsed   : string[]            — tables queried
 *     source       : "bigquery"|"fabric"
 *     dataset      : string
 *     rowCount     : number
 *     executionMs  : number
 *     bqCost       : string              — e.g. "$0.0031"
 *     aiCost       : string              — e.g. "$0.000012"
 *     userComment  : string              — optional free-text reason
 *     sessionId    : string              — to group conversation turns
 *   }
 */

const express = require('express');
const router  = express.Router();

const { insertFeedback } = require('../bigquery/feedback.writer');
const logger = require('../utils/logger');

router.post('/', async (req, res, next) => {
  const { rating, question, turnId } = req.body;

  if (!rating || !['up', 'down'].includes(rating)) {
    return res.status(400).json({ error: '`rating` must be "up" or "down".' });
  }

  if (!question || typeof question !== 'string' || question.trim() === '') {
    return res.status(400).json({ error: '`question` is required.' });
  }

  try {
    const user = req.user || {};
    await insertFeedback({
      ...req.body,
      userId:    user.id,
      userName:  user.name,
      userEmail: user.email,
    });
    return res.json({ success: true });
  } catch (err) {
    logger.error(`Feedback insert failed: ${err.message}`);
    next(err);
  }
});

module.exports = router;
