import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const {
  readConversation,
  findChatGPTInput,
  extractText,
  SELECTORS,
  readViaDataAttributes,
  readViaArticles,
  readViaProseElements,
  MAX_PAIRS_DEFAULT,
  TOKEN_CHARS_RATIO,
} = require('../../utils/dom-reader.js');

function loadFixture(name) {
  const html = readFileSync(resolve(__dirname, `../fixtures/conversations/${name}`), 'utf-8');
  document.body.innerHTML = html;
}

describe('extractText', () => {
  it('extracts plain text from an element', () => {
    document.body.innerHTML = '<div><p>Hello world</p></div>';
    const el = document.querySelector('div');
    expect(extractText(el)).toBe('Hello world');
  });

  it('converts pre/code blocks to backtick-wrapped markdown', () => {
    document.body.innerHTML = '<div><pre><code>const x = 1;</code></pre></div>';
    const el = document.querySelector('div');
    const text = extractText(el);
    expect(text).toContain('```');
    expect(text).toContain('const x = 1;');
  });

  it('converts inline code to single backticks', () => {
    document.body.innerHTML = '<div><p>Use the <code>map</code> function</p></div>';
    const el = document.querySelector('div');
    const text = extractText(el);
    expect(text).toContain('`map`');
  });

  it('adds newlines for paragraph breaks', () => {
    document.body.innerHTML = '<div><p>First</p><p>Second</p></div>';
    const el = document.querySelector('div');
    const text = extractText(el);
    expect(text).toContain('First');
    expect(text).toContain('Second');
    expect(text.indexOf('First')).toBeLessThan(text.indexOf('Second'));
  });

  it('does not mutate the original DOM', () => {
    document.body.innerHTML = '<div id="orig"><pre><code>test</code></pre></div>';
    const el = document.querySelector('#orig');
    extractText(el);
    expect(el.querySelector('pre')).not.toBeNull();
  });
});

describe('readViaDataAttributes', () => {
  it('reads messages with data-message-author-role', () => {
    loadFixture('short-conversation.html');
    const messages = readViaDataAttributes();
    expect(messages).not.toBeNull();
    expect(messages.length).toBe(6); // 3 pairs
    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('assistant');
  });

  it('returns null when no matching elements exist', () => {
    document.body.innerHTML = '<div>No messages here</div>';
    expect(readViaDataAttributes()).toBeNull();
  });

  it('skips non-user/assistant roles', () => {
    document.body.innerHTML = `
      <div data-message-author-role="system"><p>System msg</p></div>
      <div data-message-author-role="user"><p>Hello</p></div>
    `;
    const messages = readViaDataAttributes();
    expect(messages.length).toBe(1);
    expect(messages[0].role).toBe('user');
  });
});

describe('readViaArticles', () => {
  it('reads messages from article[data-testid] elements', () => {
    document.body.innerHTML = `
      <article data-testid="conversation-turn-user"><p>User message</p></article>
      <article data-testid="conversation-turn-assistant"><p>Assistant reply</p></article>
    `;
    const messages = readViaArticles();
    expect(messages).not.toBeNull();
    expect(messages.length).toBe(2);
  });

  it('infers role from testid containing human/user', () => {
    document.body.innerHTML = `
      <article data-testid="human-turn"><p>Q</p></article>
      <article data-testid="bot-response"><p>A</p></article>
    `;
    const messages = readViaArticles();
    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('assistant');
  });

  it('falls back to alternating roles for generic testids', () => {
    document.body.innerHTML = `
      <article data-testid="turn-1"><p>Q</p></article>
      <article data-testid="turn-2"><p>A</p></article>
    `;
    const messages = readViaArticles();
    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('assistant');
  });

  it('returns null when no articles found', () => {
    document.body.innerHTML = '<div>Nothing</div>';
    expect(readViaArticles()).toBeNull();
  });
});

describe('readViaProseElements', () => {
  it('reads messages from .markdown/.prose inside main', () => {
    document.body.innerHTML = `
      <main>
        <div class="markdown"><p>User says hi</p></div>
        <div class="prose"><p>Bot replies</p></div>
      </main>
    `;
    const messages = readViaProseElements();
    expect(messages).not.toBeNull();
    expect(messages.length).toBe(2);
    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('assistant');
  });

  it('returns null when no main element', () => {
    document.body.innerHTML = '<div class="markdown"><p>Hi</p></div>';
    expect(readViaProseElements()).toBeNull();
  });

  it('returns null when no prose elements in main', () => {
    document.body.innerHTML = '<main><div>No prose</div></main>';
    expect(readViaProseElements()).toBeNull();
  });
});

describe('readConversation', () => {
  it('reads a short conversation', () => {
    loadFixture('short-conversation.html');
    const result = readConversation();
    expect(result.messages.length).toBe(6);
    expect(result.truncated).toBe(false);
    expect(result.tokenEstimate).toBeGreaterThan(0);
    expect(result.error).toBeUndefined();
  });

  it('truncates to maxPairs and sets truncated flag', () => {
    loadFixture('long-conversation.html');
    const result = readConversation(20);
    expect(result.messages.length).toBe(40); // 20 pairs
    expect(result.truncated).toBe(true);
    // Should keep the LAST 20 pairs
    expect(result.messages[0].content).toContain('6');
  });

  it('respects custom maxPairs', () => {
    loadFixture('short-conversation.html');
    const result = readConversation(1);
    expect(result.messages.length).toBe(2); // 1 pair
    expect(result.truncated).toBe(true);
  });

  it('returns error for empty conversation', () => {
    loadFixture('empty-conversation.html');
    const result = readConversation();
    expect(result.messages).toEqual([]);
    expect(result.error).toBe('no_messages');
    expect(result.tokenEstimate).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it('handles code-heavy conversations', () => {
    loadFixture('code-heavy.html');
    const result = readConversation();
    expect(result.messages.length).toBe(4); // 2 pairs
    // Should preserve code block content
    const assistantMsg = result.messages[1].content;
    expect(assistantMsg).toContain('reverseString');
  });

  it('calculates tokenEstimate based on character count', () => {
    loadFixture('short-conversation.html');
    const result = readConversation();
    const totalChars = result.messages.map(m => m.content).join(' ').length;
    expect(result.tokenEstimate).toBe(Math.round(totalChars / TOKEN_CHARS_RATIO));
  });

  it('falls through strategies when primary fails', () => {
    // Only prose elements inside main, no data-message-author-role
    document.body.innerHTML = `
      <main>
        <div class="markdown"><p>User msg</p></div>
        <div class="prose"><p>Bot msg</p></div>
      </main>
    `;
    const result = readConversation();
    expect(result.messages.length).toBe(2);
  });
});

describe('findChatGPTInput', () => {
  it('finds #prompt-textarea', () => {
    document.body.innerHTML = '<textarea id="prompt-textarea"></textarea>';
    expect(findChatGPTInput()).not.toBeNull();
    expect(findChatGPTInput().id).toBe('prompt-textarea');
  });

  it('falls back to contenteditable in main', () => {
    document.body.innerHTML = '<main><div contenteditable="true"></div></main>';
    expect(findChatGPTInput()).not.toBeNull();
  });

  it('falls back to last contenteditable on page', () => {
    document.body.innerHTML = `
      <div contenteditable="true" id="first"></div>
      <div contenteditable="true" id="last"></div>
    `;
    const el = findChatGPTInput();
    expect(el.id).toBe('last');
  });

  it('falls back to textarea[placeholder]', () => {
    document.body.innerHTML = '<textarea placeholder="Type here"></textarea>';
    expect(findChatGPTInput()).not.toBeNull();
  });

  it('returns null when no input found', () => {
    document.body.innerHTML = '<div>No inputs</div>';
    expect(findChatGPTInput()).toBeNull();
  });
});

describe('SELECTORS', () => {
  it('has all required selector keys', () => {
    expect(SELECTORS.MESSAGE_WITH_ROLE).toBeDefined();
    expect(SELECTORS.ROLE_ATTRIBUTE).toBeDefined();
    expect(SELECTORS.MESSAGE_ARTICLE).toBeDefined();
    expect(SELECTORS.CONVERSATION_CONTAINER).toBeDefined();
    expect(SELECTORS.MESSAGE_PROSE).toBeDefined();
    expect(SELECTORS.INPUT_PRIMARY).toBeDefined();
  });
});
