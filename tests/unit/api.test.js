import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  buildOpenAIRequest,
  buildAnthropicRequest,
  parseOpenAIChunk,
  parseAnthropicChunk,
  getErrorMessage,
  streamAPIResponse,
  callAPI,
  DEFAULT_MODELS,
} = require('../../utils/api.js');

describe('buildOpenAIRequest', () => {
  const messages = [{ role: 'user', content: 'Hello' }];

  it('returns correct URL', () => {
    const { url } = buildOpenAIRequest(messages, 'gpt-4o', 'sk-test');
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('sets Authorization header with Bearer token', () => {
    const { options } = buildOpenAIRequest(messages, 'gpt-4o', 'sk-test');
    expect(options.headers.Authorization).toBe('Bearer sk-test');
  });

  it('sets Content-Type to application/json', () => {
    const { options } = buildOpenAIRequest(messages, 'gpt-4o', 'sk-test');
    expect(options.headers['Content-Type']).toBe('application/json');
  });

  it('includes model and messages in body', () => {
    const { options } = buildOpenAIRequest(messages, 'gpt-4o', 'sk-test');
    const body = JSON.parse(options.body);
    expect(body.model).toBe('gpt-4o');
    expect(body.messages).toEqual(messages);
    expect(body.max_tokens).toBe(4096);
  });

  it('defaults stream to true', () => {
    const { options } = buildOpenAIRequest(messages, 'gpt-4o', 'sk-test');
    const body = JSON.parse(options.body);
    expect(body.stream).toBe(true);
  });

  it('uses default model when model is falsy', () => {
    const { options } = buildOpenAIRequest(messages, null, 'sk-test');
    const body = JSON.parse(options.body);
    expect(body.model).toBe(DEFAULT_MODELS.openai);
  });

  it('can disable streaming', () => {
    const { options } = buildOpenAIRequest(messages, 'gpt-4o', 'sk-test', false);
    const body = JSON.parse(options.body);
    expect(body.stream).toBe(false);
  });
});

describe('buildAnthropicRequest', () => {
  it('returns correct URL', () => {
    const messages = [{ role: 'user', content: 'Hello' }];
    const { url } = buildAnthropicRequest(messages, 'claude-sonnet-4-20250514', 'sk-ant-test');
    expect(url).toBe('https://api.anthropic.com/v1/messages');
  });

  it('sets x-api-key and anthropic-version headers', () => {
    const messages = [{ role: 'user', content: 'Hello' }];
    const { options } = buildAnthropicRequest(messages, 'claude-sonnet-4-20250514', 'sk-ant-test');
    expect(options.headers['x-api-key']).toBe('sk-ant-test');
    expect(options.headers['anthropic-version']).toBe('2023-06-01');
  });

  it('extracts system message from first message', () => {
    const messages = [
      { role: 'system', content: 'You are helpful' },
      { role: 'user', content: 'Hello' },
    ];
    const { options } = buildAnthropicRequest(messages, 'claude-sonnet-4-20250514', 'sk-ant-test');
    const body = JSON.parse(options.body);
    expect(body.system).toBe('You are helpful');
    expect(body.messages).toEqual([{ role: 'user', content: 'Hello' }]);
  });

  it('does not set system when first message is not system role', () => {
    const messages = [{ role: 'user', content: 'Hello' }];
    const { options } = buildAnthropicRequest(messages, null, 'sk-ant-test');
    const body = JSON.parse(options.body);
    expect(body.system).toBeUndefined();
    expect(body.model).toBe(DEFAULT_MODELS.anthropic);
  });
});

describe('parseOpenAIChunk', () => {
  it('parses a valid data line with content', () => {
    const line = 'data: {"choices":[{"delta":{"content":"Hello"}}]}';
    expect(parseOpenAIChunk(line)).toBe('Hello');
  });

  it('returns null for [DONE]', () => {
    expect(parseOpenAIChunk('data: [DONE]')).toBeNull();
  });

  it('returns null for non-data lines', () => {
    expect(parseOpenAIChunk('event: message')).toBeNull();
    expect(parseOpenAIChunk('')).toBeNull();
  });

  it('returns null for delta with no content', () => {
    const line = 'data: {"choices":[{"delta":{}}]}';
    expect(parseOpenAIChunk(line)).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parseOpenAIChunk('data: {invalid')).toBeNull();
  });
});

describe('parseAnthropicChunk', () => {
  it('parses content_block_delta with text_delta', () => {
    const line = 'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}';
    expect(parseAnthropicChunk(line)).toBe('Hello');
  });

  it('returns null for message_start events', () => {
    const line = 'data: {"type":"message_start","message":{"id":"msg_123"}}';
    expect(parseAnthropicChunk(line)).toBeNull();
  });

  it('returns null for non-data lines', () => {
    expect(parseAnthropicChunk('event: content_block_delta')).toBeNull();
    expect(parseAnthropicChunk('')).toBeNull();
  });

  it('returns null for content_block_stop', () => {
    const line = 'data: {"type":"content_block_stop","index":0}';
    expect(parseAnthropicChunk(line)).toBeNull();
  });
});

describe('getErrorMessage', () => {
  it('returns invalid key message for 401', () => {
    expect(getErrorMessage(401, 'openai')).toContain('invalid');
  });

  it('returns permission message for 403', () => {
    expect(getErrorMessage(403, 'openai')).toContain('permission');
  });

  it('returns rate limit message for 429', () => {
    expect(getErrorMessage(429, 'openai')).toContain('Rate limited');
  });

  it('returns provider-specific server error for 500', () => {
    expect(getErrorMessage(500, 'anthropic')).toContain('Anthropic');
    expect(getErrorMessage(500, 'openai')).toContain('OpenAI');
  });

  it('returns generic message for unknown status codes', () => {
    expect(getErrorMessage(418, 'openai')).toContain('418');
  });
});

describe('streamAPIResponse', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('yields text chunks from a streaming response', async () => {
    const sseData = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      'data: {"choices":[{"delta":{"content":" world"}}]}',
      'data: [DONE]',
    ].join('\n');

    const mockReader = {
      read: vi.fn()
        .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(sseData) })
        .mockResolvedValueOnce({ done: true }),
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => mockReader },
    });

    const chunks = [];
    for await (const chunk of streamAPIResponse('openai', [], 'gpt-4o', 'sk-test')) {
      chunks.push(chunk);
    }

    expect(chunks).toContainEqual({ text: 'Hello' });
    expect(chunks).toContainEqual({ text: ' world' });
    expect(chunks[chunks.length - 1]).toEqual({ done: true });
  });

  it('yields error on network failure', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const chunks = [];
    for await (const chunk of streamAPIResponse('openai', [], 'gpt-4o', 'sk-test')) {
      chunks.push(chunk);
    }

    expect(chunks[0]).toHaveProperty('error');
  });

  it('yields error on non-ok response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
    });

    const chunks = [];
    for await (const chunk of streamAPIResponse('openai', [], 'gpt-4o', 'sk-test')) {
      chunks.push(chunk);
    }

    expect(chunks[0]).toHaveProperty('error');
    expect(chunks[0].error).toContain('invalid');
  });
});

describe('callAPI', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns OpenAI response text', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: 'Hello from GPT' } }],
      }),
    });

    const result = await callAPI('openai', [{ role: 'user', content: 'Hi' }], 'gpt-4o', 'sk-test');
    expect(result).toBe('Hello from GPT');
  });

  it('returns Anthropic response text', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        content: [{ text: 'Hello from Claude' }],
      }),
    });

    const result = await callAPI('anthropic', [{ role: 'user', content: 'Hi' }], 'claude-sonnet-4-20250514', 'sk-ant-test');
    expect(result).toBe('Hello from Claude');
  });

  it('throws on network failure', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('fail'));
    await expect(callAPI('openai', [], 'gpt-4o', 'sk-test')).rejects.toThrow('reach the API');
  });

  it('throws on non-ok response with error message', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
    });
    await expect(callAPI('openai', [], 'gpt-4o', 'sk-test')).rejects.toThrow('Rate limited');
  });
});
