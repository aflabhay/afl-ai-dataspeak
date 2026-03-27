/**
 * tests/unit/openai.test.js
 * ──────────────────────────
 * Unit tests for the OpenAI client wrapper.
 * Uses Jest mocking to avoid real API calls.
 */

jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue({
          choices: [{ message: { content: '```sql\nSELECT 1\n```\n\nThis is a test.' } }],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        }),
      },
    },
  }));
});

const { ask } = require('../../src/openai/openai.client');

describe('openai.client — ask()', () => {

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'sk-test-key';
    process.env.OPENAI_MODEL   = 'gpt-4o-mini';
  });

  test('returns text response from GPT', async () => {
    const result = await ask('You are a SQL expert.', 'Show me 1 row');
    expect(result).toContain('SELECT 1');
  });

  test('uses gpt-4o-mini model by default', () => {
    expect(process.env.OPENAI_MODEL).toBe('gpt-4o-mini');
  });

});
