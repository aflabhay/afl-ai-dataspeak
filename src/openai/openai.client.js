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
const MAX_TOKENS     = 4096;
const MAX_RETRIES    = 3;
const RETRY_DELAY_MS = 1000;

// Pricing per 1M tokens (USD) — update if OpenAI changes rates
const PRICING = {
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4o':      { input: 2.50, output: 10.00 },
  'gpt-4-turbo': { input: 10.00, output: 30.00 },
};

function calcCost(usage) {
  const rates = PRICING[MODEL] || PRICING['gpt-4o-mini'];
  const inputCost  = (usage.prompt_tokens     / 1_000_000) * rates.input;
  const outputCost = (usage.completion_tokens / 1_000_000) * rates.output;
  return {
    model:            MODEL,
    promptTokens:     usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens:      usage.total_tokens,
    estimatedCost:    `$${(inputCost + outputCost).toFixed(6)}`,
  };
}

/**
 * Send a conversation to GPT and return the text reply.
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
      const response = await client.chat.completions.create({
        model:      MODEL,
        max_tokens: MAX_TOKENS,
        messages: [
          { role: 'system', content: systemPrompt },
          ...history,
        ],
      });

      const usage    = response.usage;
      const aiCost   = calcCost(usage);
      logger.info('OpenAI token usage', aiCost);

      return { text: response.choices[0].message.content, aiCost };

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
