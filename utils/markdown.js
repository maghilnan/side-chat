/**
 * markdown.js — Markdown rendering utilities for SideChat
 *
 * Extracted from sidepanel.js for testability.
 * Dual export: module.exports for Node/Vitest, window.SidechatMarkdown for browser.
 */

(function () {

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function processLists(html) {
  const lines = html.split('\n');
  const out = [];
  let listType = null; // 'ol' or 'ul'
  let listItems = [];

  function flushList() {
    if (!listType) return;
    const items = listItems.map(i => `<li>${i}</li>`).join('');
    out.push(`<${listType}>${items}</${listType}>`);
    listType = null;
    listItems = [];
  }

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const olMatch = line.match(/^\d+\. (.+)/);
    const ulMatch = line.match(/^[-*] (.+)/);

    if (olMatch) {
      if (listType === 'ul') flushList();
      listType = 'ol';
      listItems.push(olMatch[1]);
      i++;
    } else if (ulMatch) {
      if (listType === 'ol') flushList();
      listType = 'ul';
      listItems.push(ulMatch[1]);
      i++;
    } else if (line.trim() === '' && listType) {
      // Blank line inside a list — peek ahead to see if it's a loose list
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j++;
      const nextLine = j < lines.length ? lines[j] : '';
      const continuesList =
        (listType === 'ol' && /^\d+\. /.test(nextLine)) ||
        (listType === 'ul' && /^[-*] /.test(nextLine));
      if (continuesList) {
        i = j; // skip blank lines, stay in current list
      } else {
        flushList();
        out.push(line);
        i++;
      }
    } else {
      flushList();
      out.push(line);
      i++;
    }
  }
  flushList();
  return out.join('\n');
}

/**
 * Converts markdown text to an HTML string.
 * XSS-safe: all user content is HTML-escaped before any markdown tags are applied.
 */
function renderMarkdown(text) {
  // Step 1: Extract fenced code blocks to protect them from other processing
  const codeBlocks = [];
  let html = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, _lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(`<pre><code>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`);
    return `\x00CODEBLOCK${idx}\x00`;
  });

  // Step 2: Escape HTML in non-code content (split on placeholders to avoid double-escaping)
  html = html.split('\x00').map((part, i) => {
    // Odd-indexed parts are placeholder tokens like "CODE_BLOCK_0"
    if (i % 2 === 1 && part.startsWith('CODEBLOCK')) return '\x00' + part + '\x00';
    return escapeHtml(part);
  }).join('');

  // Step 3: Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Step 4: Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Step 5: Blockquotes (match escaped "&gt;" since HTML is already escaped)
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

  // Step 6: Bold and italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');

  // Steps 7 & 8: Unordered and ordered lists
  html = processLists(html);

  // Step 9: Wrap remaining content in paragraphs; double newlines = new paragraph
  const blockTagRe = /^<(h[1-3]|ul|ol|li|blockquote|pre|p)/;
  const segments = html.split(/\n\n+/);
  html = segments.map(seg => {
    seg = seg.trim();
    if (!seg) return '';
    if (blockTagRe.test(seg) || seg.startsWith('\x00CODEBLOCK')) return seg;
    // Single newlines within a paragraph become <br>
    return `<p>${seg.replace(/\n/g, '<br>')}</p>`;
  }).filter(Boolean).join('\n');

  // Step 10: Restore fenced code blocks
  codeBlocks.forEach((block, i) => {
    html = html.replace(`\x00CODEBLOCK${i}\x00`, block);
  });

  return html;
}

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { escapeHtml, processLists, renderMarkdown };
  } else if (typeof window !== 'undefined') {
    window.SidechatMarkdown = { escapeHtml, processLists, renderMarkdown };
  }
})();
