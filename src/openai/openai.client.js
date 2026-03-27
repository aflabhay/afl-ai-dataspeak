/**
 * src/openai/openai.client.js
 * ───────────────────────────
 * Thin wrapper around the OpenAI SDK.
 *
 * Drop-in replacement for src/claude/claude.client.js
 *
 * Uses gpt-4o-mini by default — significantly cheaper than gpt-4o
 * while still capable of generating accurate SQL queries.
 *
 * Cost comparison (per 1M tokens as of 2026):
 *   gpt-4o       → $2.50 input / $10.00 output
 *   gpt-4o-mini  → $0.15 input / $0.60 output  ← 16x cheaper
 *
 * Responsibilities:
 *  - Initialise the OpenAI client once (singleton)
 *  - Send messages and return the text response
 *  - Handle retries on transient errors
 *  - Log token usage for cost tracking
 *
 * Environment variables required:
 *   OPENAI_API_KEY  — your OpenAI API key (sk-...)
 *   OPENAI_MODEL    — optional, defaults to gpt-4o
 */

const OpenAI = require('openai');
const logger  = require('../utils/logger');

// ── Singleton client ──────────────────────────────────────────────────────────
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL          = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const MAX_TOKENS     = 2048;
const MAX_RETRIES    = 3;
const RETRY_DELAY_MS = 1000;

/**
 * Send a question to GPT-4o with a system prompt and return the text reply.
 *
 * @param {string} systemPrompt — context about the data source and schema
 * @param {string} userQuestion — the natural language question
 * @returns {Promise<string>}   — GPT's full text response
 */
async function ask(systemPrompt, userQuestion) {
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    try {
      const response = await client.chat.completions.create({
        model:      MODEL,
        max_tokens: MAX_TOKENS,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userQuestion },
        ],
      });

      // Log token usage for cost monitoring
      const usage = response.usage;
      logger.info('OpenAI token usage', {
        model:         MODEL,
        prompt_tokens:     usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        total_tokens:      usage.total_tokens,
      });

      return response.choices[0].message.content;

    } catch (err) {
      attempt++;
      logger.warn(`OpenAI API attempt ${attempt} failed: ${err.message}`);

      if (attempt >= MAX_RETRIES) throw err;

      // Exponential backoff
      await sleep(RETRY_DELAY_MS * attempt);
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { ask };
