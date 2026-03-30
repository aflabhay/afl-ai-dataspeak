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

// Pricing per 1M tokens (USD)
const PRICING = { input: 3.00, output: 15.00 };

function calcCost(usage) {
  const inputCost  = (usage.input_tokens  / 1_000_000) * PRICING.input;
  const outputCost = (usage.output_tokens / 1_000_000) * PRICING.output;
  return {
    model:            MODEL,
    promptTokens:     usage.input_tokens,
    completionTokens: usage.output_tokens,
    totalTokens:      usage.input_tokens + usage.output_tokens,
    estimatedCost:    `$${(inputCost + outputCost).toFixed(6)}`,
  };
}

/**
 * Send a conversation to Claude and return the text reply.
 *
 * @param {string}   systemPrompt — context about the data source and schema
 * @param {string|Array} messages — single question string OR [{role,content}] history array
 * @returns {Promise<string>}
 */
async function ask(systemPrompt, messages) {
  const history = Array.isArray(messages)
    ? messages
    : [{ role: 'user', content: messages }];

  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    try {
      const response = await client.messages.create({
        model:      MODEL,
        max_tokens: MAX_TOKENS,
        system:     systemPrompt,
        messages:   history,
      });

      const usage  = response.usage;
      const aiCost = calcCost(usage);
      logger.info('Claude token usage', aiCost);

      return { text: response.content[0].text, aiCost };

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
