/**
 * dom-reader.js — ChatGPT DOM parsing logic
 *
 * ALL selectors are defined at the top as constants.
 * When ChatGPT updates their frontend, only update the SELECTORS object below.
 */

const SELECTORS = {
  // Primary: data attributes (current ChatGPT structure as of 2025)
  MESSAGE_WITH_ROLE: '[data-message-author-role]',
  ROLE_ATTRIBUTE: 'data-message-author-role',

  // Fallback 1: article elements used in some ChatGPT versions
  MESSAGE_ARTICLE: 'article[data-testid]',
  ARTICLE_ROLE_PREFIX: 'conversation-turn-',

  // Fallback 2: generic message containers
  CONVERSATION_CONTAINER: 'main',
  MESSAGE_PROSE: '.markdown, .prose',

  // ChatGPT input field selectors (for paste)
  INPUT_PRIMARY: '#prompt-textarea',
  INPUT_FALLBACK_1: '[data-id="root"]',
  INPUT_FALLBACK_2: 'textarea[placeholder]',
  INPUT_CONTENT_EDITABLE: '[contenteditable="true"]',
};

const MAX_PAIRS_DEFAULT = 20;
const TOKEN_CHARS_RATIO = 4; // 1 token ≈ 4 chars

/**
 * Strip HTML tags and clean up whitespace.
 * Preserves code blocks by wrapping them in triple backticks.
 */
function extractText(element) {
  // Clone to avoid mutating the live DOM
  const clone = element.cloneNode(true);

  // Convert code blocks to markdown-style triple backticks
  clone.querySelectorAll('pre').forEach(pre => {
    const code = pre.textContent.trim();
    pre.replaceWith(`\n\`\`\`\n${code}\n\`\`\`\n`);
  });

  // Inline code
  clone.querySelectorAll('code').forEach(code => {
    code.replaceWith(`\`${code.textContent}\``);
  });

  // Paragraph breaks
  clone.querySelectorAll('p, br').forEach(el => {
    el.after('\n');
  });

  return clone.textContent.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Strategy 1: Read messages via data-message-author-role attributes.
 * Returns [{role, content}] or null if no messages found.
 */
function readViaDataAttributes() {
  const elements = document.querySelectorAll(SELECTORS.MESSAGE_WITH_ROLE);
  if (!elements.length) return null;

  const messages = [];
  elements.forEach(el => {
    const role = el.getAttribute(SELECTORS.ROLE_ATTRIBUTE);
    if (role !== 'user' && role !== 'assistant') return;
    const content = extractText(el);
    if (content) {
      messages.push({ role, content });
    }
  });

  return messages.length > 0 ? messages : null;
}

/**
 * Strategy 2: Read via article elements with testid attributes.
 */
function readViaArticles() {
  const articles = document.querySelectorAll(SELECTORS.MESSAGE_ARTICLE);
  if (!articles.length) return null;

  const messages = [];
  articles.forEach((article, index) => {
    // Infer role from even/odd position (user=even, assistant=odd) or testid
    const testId = article.getAttribute('data-testid') || '';
    let role;
    if (testId.includes('human') || testId.includes('user')) {
      role = 'user';
    } else if (testId.includes('assistant') || testId.includes('bot')) {
      role = 'assistant';
    } else {
      // Fallback: alternate (user first typically)
      role = index % 2 === 0 ? 'user' : 'assistant';
    }
    const content = extractText(article);
    if (content) {
      messages.push({ role, content });
    }
  });

  return messages.length > 0 ? messages : null;
}

/**
 * Strategy 3: Last resort — find all prose/markdown containers and alternate roles.
 */
function readViaProseElements() {
  const container = document.querySelector(SELECTORS.CONVERSATION_CONTAINER);
  if (!container) return null;

  const proseEls = container.querySelectorAll(SELECTORS.MESSAGE_PROSE);
  if (!proseEls.length) return null;

  const messages = [];
  proseEls.forEach((el, index) => {
    const content = extractText(el);
    if (content) {
      messages.push({
        role: index % 2 === 0 ? 'user' : 'assistant',
        content,
      });
    }
  });

  return messages.length > 0 ? messages : null;
}

/**
 * Main entry point. Reads the current ChatGPT conversation.
 * @param {number} maxPairs - Maximum number of user+assistant pairs to return
 * @returns {{ messages: Array, tokenEstimate: number, truncated: boolean, error?: string }}
 */
function readConversation(maxPairs = MAX_PAIRS_DEFAULT) {
  let messages = null;

  // Try each strategy in order
  messages = readViaDataAttributes();
  if (!messages) messages = readViaArticles();
  if (!messages) messages = readViaProseElements();

  if (!messages || messages.length === 0) {
    return {
      messages: [],
      tokenEstimate: 0,
      truncated: false,
      error: 'no_messages',
    };
  }

  // Limit to maxPairs (count pairs of user+assistant)
  const truncated = messages.length > maxPairs * 2;
  if (truncated) {
    messages = messages.slice(-maxPairs * 2);
  }

  const fullText = messages.map(m => m.content).join(' ');
  const tokenEstimate = Math.round(fullText.length / TOKEN_CHARS_RATIO);

  return { messages, tokenEstimate, truncated };
}

/**
 * Find the ChatGPT input element for pasting text.
 * Returns the element or null.
 */
function findChatGPTInput() {
  // Try primary selector
  let el = document.querySelector(SELECTORS.INPUT_PRIMARY);
  if (el) return el;

  // Try contenteditable inside main
  const main = document.querySelector('main');
  if (main) {
    el = main.querySelector(SELECTORS.INPUT_CONTENT_EDITABLE);
    if (el) return el;
  }

  // Fallback: any contenteditable in the page footer/form area
  const allEditable = document.querySelectorAll(SELECTORS.INPUT_CONTENT_EDITABLE);
  if (allEditable.length) return allEditable[allEditable.length - 1];

  // Last resort: textarea
  el = document.querySelector(SELECTORS.INPUT_FALLBACK_2);
  return el || null;
}

// Dual export: module.exports for Node/Vitest, window for browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { readConversation, findChatGPTInput, extractText, SELECTORS, readViaDataAttributes, readViaArticles, readViaProseElements, MAX_PAIRS_DEFAULT, TOKEN_CHARS_RATIO };
} else if (typeof window !== 'undefined') {
  window.__sidechat_domReader = { readConversation, findChatGPTInput };
}
