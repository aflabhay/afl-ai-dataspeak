/**
 * src/claude/claude.client.js
 * ───────────────────────────
 * Thin wrapper around the Anthropic SDK.
 *
 * Responsibilities:
 *  - Initialise the Anthropic client once (singleton)
 *  - Send messages and return the text response
 *  - Handle retries on transient errors
 *  - Log token usage for cost tracking
 */

const Anthropic = require('@anthropic-ai/sdk');
const logger    = require('../utils/logger');

// ── Singleton client ──────────────────────────────────────────────────────────
const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL          = 'claude-sonnet-4-20250514';
const MAX_TOKENS     = 2048;
const MAX_RETRIES    = 3;
const RETRY_DELAY_MS = 1000;

/**
 * Send a question to Claude with a system prompt and return the text reply.
 *
 * @param {string} systemPrompt — context about the data source and schema
 * @param {string} userQuestion — the natural language question
 * @returns {Promise<string>}   — Claude's full text response
 */
async function ask(systemPrompt, userQuestion) {
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    try {
      const response = await client.messages.create({
        model:      MODEL,
        max_tokens: MAX_TOKENS,
        system:     systemPrompt,
        messages: [
          { role: 'user', content: userQuestion },
        ],
      });

      // Log token usage for monitoring
      const usage = response.usage;
      logger.info('Claude token usage', {
        input_tokens:  usage.input_tokens,
        output_tokens: usage.output_tokens,
        total:         usage.input_tokens + usage.output_tokens,
      });

      return response.content[0].text;

    } catch (err) {
      attempt++;
      logger.warn(`Claude API attempt ${attempt} failed: ${err.message}`);

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
