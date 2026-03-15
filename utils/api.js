/**
 * api.js — OpenAI and Anthropic API wrappers
 * Used exclusively by background.js (service worker).
 */

const DEFAULT_MODELS = {
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-20250514',
};

const API_ENDPOINTS = {
  openai: 'https://api.openai.com/v1/chat/completions',
  anthropic: 'https://api.anthropic.com/v1/messages',
};

const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Build fetch options for a streaming OpenAI request.
 */
function buildOpenAIRequest(messages, model, apiKey, stream = true) {
  return {
    url: API_ENDPOINTS.openai,
    options: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || DEFAULT_MODELS.openai,
        messages,
        stream,
        max_tokens: 4096,
      }),
    },
  };
}

/**
 * Build fetch options for a streaming Anthropic request.
 * Anthropic requires system message to be separate.
 */
function buildAnthropicRequest(messages, model, apiKey, stream = true) {
  // Extract system message if present
  let system;
  let filteredMessages = messages;
  if (messages[0]?.role === 'system') {
    system = messages[0].content;
    filteredMessages = messages.slice(1);
  }

  const body = {
    model: model || DEFAULT_MODELS.anthropic,
    messages: filteredMessages,
    stream,
    max_tokens: 4096,
  };
  if (system) body.system = system;

  return {
    url: API_ENDPOINTS.anthropic,
    options: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    },
  };
}

/**
 * Parse a single SSE line from OpenAI streaming response.
 * Returns the text delta or null.
 */
function parseOpenAIChunk(line) {
  if (!line.startsWith('data: ')) return null;
  const data = line.slice(6).trim();
  if (data === '[DONE]') return null;
  try {
    const json = JSON.parse(data);
    return json.choices?.[0]?.delta?.content ?? null;
  } catch {
    return null;
  }
}

/**
 * Parse a single SSE line from Anthropic streaming response.
 * Returns the text delta or null.
 */
function parseAnthropicChunk(line) {
  if (!line.startsWith('data: ')) return null;
  const data = line.slice(6).trim();
  try {
    const json = JSON.parse(data);
    if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
      return json.delta.text ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Map HTTP status / error codes to user-friendly messages.
 */
function getErrorMessage(status, provider) {
  const map = {
    401: 'API key is invalid. Check your settings.',
    403: 'API key does not have permission for this model.',
    429: 'Rate limited. Wait a moment and try again.',
    500: `${provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} server error. Try again shortly.`,
    503: 'API service is temporarily unavailable. Try again shortly.',
  };
  return map[status] || `API error (${status}). Please try again.`;
}

/**
 * Stream an API response, yielding text chunks.
 * Returns an async generator: yields {text} chunks, then {done: true} or {error}.
 */
async function* streamAPIResponse(provider, messages, model, apiKey) {
  const builder = provider === 'anthropic' ? buildAnthropicRequest : buildOpenAIRequest;
  const parser = provider === 'anthropic' ? parseAnthropicChunk : parseOpenAIChunk;

  const { url, options } = builder(messages, model, apiKey, true);

  let response;
  try {
    response = await fetch(url, options);
  } catch (err) {
    yield { error: "Couldn't reach the API. Check your connection." };
    return;
  }

  if (!response.ok) {
    const msg = getErrorMessage(response.status, provider);
    yield { error: msg };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete line

    for (const line of lines) {
      const text = parser(line);
      if (text !== null) {
        yield { text };
      }
    }
  }

  // Handle any remaining buffer
  if (buffer.trim()) {
    const text = parser(buffer);
    if (text !== null) yield { text };
  }

  yield { done: true };
}

/**
 * Make a single (non-streaming) API call. Returns the full response text.
 */
async function callAPI(provider, messages, model, apiKey) {
  const builder = provider === 'anthropic' ? buildAnthropicRequest : buildOpenAIRequest;
  const { url, options } = builder(messages, model, apiKey, false);

  let response;
  try {
    response = await fetch(url, options);
  } catch {
    throw new Error("Couldn't reach the API. Check your connection.");
  }

  if (!response.ok) {
    throw new Error(getErrorMessage(response.status, provider));
  }

  const json = await response.json();

  if (provider === 'anthropic') {
    return json.content?.[0]?.text ?? '';
  } else {
    return json.choices?.[0]?.message?.content ?? '';
  }
}

// Export for use in background.js
// (Service worker uses module-style imports or global assignment)
if (typeof module !== 'undefined') {
  module.exports = { buildOpenAIRequest, buildAnthropicRequest, parseOpenAIChunk, parseAnthropicChunk, streamAPIResponse, callAPI, DEFAULT_MODELS, getErrorMessage };
} else {
  self.SidechatAPI = { buildOpenAIRequest, buildAnthropicRequest, parseOpenAIChunk, parseAnthropicChunk, streamAPIResponse, callAPI, DEFAULT_MODELS, getErrorMessage };
}
