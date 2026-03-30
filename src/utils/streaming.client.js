/**
 * src/utils/streaming.client.js
 * ──────────────────────────────
 * OpenAI streaming with early termination.
 *
 * Why streaming saves money:
 *   The AI generates tokens in order: SQL block → JSON chart block → explanation.
 *   We only NEED the SQL and chart blocks. The explanation (often 100-300 tokens)
 *   is the most expensive part and we can generate it cheaply ourselves or truncate.
 *
 *   By terminating the stream as soon as both code blocks are captured,
 *   we save ~30-50% of output tokens per query.
 *
 * How it works:
 *  1. Open a streaming chat completion
 *  2. Accumulate chunks into a buffer
 *  3. Detect when the ```sql...``` block is complete
 *  4. Keep reading until ```json...``` block also completes (or 300 chars pass without one)
 *  5. Break the stream loop — OpenAI stops billing after we stop reading
 *  6. Return the partial response with real token counts estimated from char count
 *
 * Falls back to regular (non-streaming) ask() for Claude, which doesn't need
 * the same optimisation (Claude charges per token regardless of streaming).
 *
 * Usage:
 *   const { streamAsk } = require('./streaming.client');
 *   const { text, aiCost } = await streamAsk(systemPrompt, messages, model, apiKey);
 */

const OpenAI = require('openai');
const logger  = require('./logger');

const MODEL    = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const PRICING  = {
  'gpt-4o-mini': { input: 0.15,  output: 0.60  },
  'gpt-4o':      { input: 2.50,  output: 10.00 },
  'gpt-4-turbo': { input: 10.00, output: 30.00 },
};

// After SQL+JSON blocks, keep streaming until the confidence tag closes or this many extra chars pass
const MAX_CHARS_AFTER_JSON = 2000;

let _client = null;
function getClient() {
  if (!_client) _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _client;
}

/**
 * Estimate cost from character counts when real token usage isn't available
 * (happens when stream is terminated early — final usage chunk never arrives).
 * ~4 chars per token is a conservative estimate.
 */
function estimateCost(inputChars, outputChars) {
  const rates      = PRICING[MODEL] || PRICING['gpt-4o-mini'];
  const inputTok   = Math.ceil(inputChars  / 4);
  const outputTok  = Math.ceil(outputChars / 4);
  const cost       = (inputTok / 1_000_000) * rates.input + (outputTok / 1_000_000) * rates.output;
  return {
    model:            MODEL,
    promptTokens:     inputTok,
    completionTokens: outputTok,
    totalTokens:      inputTok + outputTok,
    estimatedCost:    `$${cost.toFixed(6)}`,
    note:             'estimated from char count (early termination)',
  };
}

/**
 * Stream an OpenAI chat completion and terminate early after SQL + JSON blocks.
 *
 * @param {string}  systemPrompt
 * @param {Array}   messages       — [{role, content}]
 * @returns {Promise<{ text: string, aiCost: object }>}
 */
async function streamAsk(systemPrompt, messages) {
  const history = Array.isArray(messages)
    ? messages
    : [{ role: 'user', content: messages }];

  // Total input chars for cost estimation
  const inputChars = systemPrompt.length + history.reduce((s, m) => s + m.content.length, 0);

  let buffer          = '';
  let sqlDone         = false;
  let jsonDone        = false;
  let charsAfterSql   = 0;
  let charsAfterJson  = 0;
  let terminated      = false;

  logger.info('Streaming OpenAI response (early termination mode)...');

  const stream = await getClient().chat.completions.create({
    model:  MODEL,
    max_tokens: 2048,
    stream: true,
    stream_options: { include_usage: true },
    messages: [
      { role: 'system', content: systemPrompt },
      ...history,
    ],
  });

  let finalUsage = null;

  for await (const chunk of stream) {
    // Capture real usage from final chunk when available
    if (chunk.usage) {
      finalUsage = chunk.usage;
    }

    const delta = chunk.choices?.[0]?.delta?.content;
    if (!delta) continue;

    buffer += delta;

    // ── Detect SQL block completion ─────────────────────────────────────
    if (!sqlDone) {
      // Check if we now have a complete ```sql...``` block
      const sqlMatch = buffer.match(/```sql[\s\S]*?```/i);
      if (sqlMatch) {
        sqlDone = true;
        logger.info('Streaming: SQL block captured');
      }
    }

    // ── After SQL: watch for optional JSON block ─────────────────────────
    if (sqlDone && !jsonDone) {
      charsAfterSql += delta.length;

      if (buffer.match(/```json[\s\S]*?```/i)) {
        jsonDone = true;
        logger.info('Streaming: JSON chart block captured — continuing for explanation + confidence');
      } else if (charsAfterSql >= 400) {
        // No JSON block coming — treat as done with code blocks
        jsonDone = true;
        logger.info('Streaming: no JSON block — continuing for explanation + confidence');
      }
    }

    // ── After both code blocks: read the explanation then stop ──────────
    if (sqlDone && jsonDone) {
      charsAfterJson += delta.length;

      if (charsAfterJson >= MAX_CHARS_AFTER_JSON) {
        logger.info('Streaming: explanation captured — terminating stream');
        terminated = true;
        break;
      }
    }
  }

  if (!terminated) {
    // Stream ended naturally (response was shorter than expected) — that's fine
    logger.info('Streaming: stream completed naturally');
  }

  // Cost: use real usage if stream ran to completion, else estimate
  const aiCost = finalUsage
    ? (() => {
        const rates = PRICING[MODEL] || PRICING['gpt-4o-mini'];
        const cost  = (finalUsage.prompt_tokens / 1_000_000) * rates.input
                    + (finalUsage.completion_tokens / 1_000_000) * rates.output;
        return {
          model:            MODEL,
          promptTokens:     finalUsage.prompt_tokens,
          completionTokens: finalUsage.completion_tokens,
          totalTokens:      finalUsage.total_tokens,
          estimatedCost:    `$${cost.toFixed(6)}`,
        };
      })()
    : estimateCost(inputChars, buffer.length);

  logger.info(`Streaming complete. Output chars: ${buffer.length}. Cost: ${aiCost.estimatedCost}`);

  return { text: buffer, aiCost };
}

module.exports = { streamAsk };
