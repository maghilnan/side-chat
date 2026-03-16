/**
 * content-script.js — Injected into chatgpt.com
 * Reads the conversation DOM and handles text paste requests.
 */

(function () {
  'use strict';

  const { readConversation, findChatGPTInput } = window.__sidechat_domReader;

  let panelOpen = false;
  let mutationObserver = null;

  // ── URL change detection (SPA navigation = new conversation) ─────────────

  let lastUrl = location.href;

  function isConversationChange(oldUrl, newUrl) {
    try {
      return new URL(oldUrl).pathname !== new URL(newUrl).pathname;
    } catch { return false; }
  }

  function checkUrlChange() {
    if (location.href !== lastUrl) {
      const changed = isConversationChange(lastUrl, location.href);
      lastUrl = location.href;
      if (changed) {
        chrome.runtime.sendMessage({ type: 'NEW_CONVERSATION' }).catch(() => {});
      }
    }
  }

  // SPA route changes don't fire load events; observe body childList + popstate
  const navObserver = new MutationObserver(checkUrlChange);
  navObserver.observe(document.body, { childList: true });
  window.addEventListener('popstate', checkUrlChange);

  // ── Ask SideChat button injection ─────────────────────────────────────────

  function findAskChatGPTContainer(root) {
    // Walk the added subtree looking for a button with "Ask ChatGPT" text
    const search = (el) => {
      if (!el || el.nodeType !== Node.ELEMENT_NODE) return null;
      if (el.tagName === 'BUTTON' && el.textContent.includes('Ask ChatGPT')) {
        return el.closest('.fixed') || el.parentElement;
      }
      for (const child of el.children) {
        const found = search(child);
        if (found) return found;
      }
      return null;
    };
    return search(root);
  }

  function injectAskSideChat(container) {
    if (!container) return;
    if (container.querySelector('[data-sidechat-btn]')) return; // already injected

    const innerDiv = container.querySelector('div');
    if (!innerDiv) return;
    const existingBtn = innerDiv.querySelector('button');
    if (!existingBtn) return;

    // Thin separator matching the toolbar style
    const sep = document.createElement('div');
    sep.setAttribute('aria-hidden', 'true');
    sep.style.cssText = 'width:1px;background:rgba(128,128,128,0.25);align-self:stretch;flex-shrink:0;margin:4px 0;';
    innerDiv.appendChild(sep);

    // Mirror the existing button's className for visual consistency
    const btn = document.createElement('button');
    btn.className = existingBtn.className;
    btn.setAttribute('data-sidechat-btn', 'true');
    btn.setAttribute('type', 'button');
    btn.setAttribute('title', 'Ask SideChat');

    const outerDiv = document.createElement('div');
    outerDiv.className = 'flex items-center justify-center';

    const span = document.createElement('span');
    span.className = 'flex items-center gap-1.5 select-none';

    // Chat-bubble SVG icon
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    svg.setAttribute('viewBox', '0 0 20 20');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('aria-hidden', 'true');
    const p1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p1.setAttribute('d', 'M2 5a2 2 0 012-2h7a2 2 0 012 2v4a2 2 0 01-2 2H9l-3 3v-3H4a2 2 0 01-2-2V5z');
    const p2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p2.setAttribute('d', 'M15 7v2a4 4 0 01-4 4H9.828l-1.766 1.767c.28.149.599.233.938.233h2l3 3v-3h2a2 2 0 002-2V9a2 2 0 00-2-2h-1z');
    svg.appendChild(p1);
    svg.appendChild(p2);

    const label = document.createElement('span');
    label.className = 'whitespace-nowrap select-none max-md:sr-only';
    label.textContent = 'Ask SideChat';

    span.appendChild(svg);
    span.appendChild(label);
    outerDiv.appendChild(span);
    btn.appendChild(outerDiv);

    // Prevent mousedown from clearing the text selection before we can read it
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
    });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const selectedText = window.getSelection()?.toString().trim() || '';
      chrome.runtime.sendMessage({ type: 'ASK_SIDECHAT', selectedText }).catch(() => {});
    });

    innerDiv.appendChild(btn);
  }

  // Watch for the Ask ChatGPT tooltip appearing in the DOM
  const tooltipObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const container = findAskChatGPTContainer(node);
        if (container) injectAskSideChat(container);
      }
    }
  });
  tooltipObserver.observe(document.body, { childList: true, subtree: true });

  // ── Message listener from background ─────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'READ_CONTEXT') {
      const maxPairs = message.maxPairs || 20;
      try {
        const result = readConversation(maxPairs);
        sendResponse({ success: true, ...result });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return true; // async response
    }

    if (message.type === 'PASTE_TEXT') {
      const { text } = message;
      const result = pasteIntoInput(text);
      sendResponse(result);
      return true;
    }

    if (message.type === 'PANEL_OPENED') {
      panelOpen = true;
      startMutationObserver();
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'PANEL_CLOSED') {
      panelOpen = false;
      stopMutationObserver();
      sendResponse({ success: true });
      return true;
    }
  });

  // ── Paste logic ───────────────────────────────────────────────────────────

  function pasteIntoInput(text) {
    const input = findChatGPTInput();

    if (!input) {
      return { success: false, reason: 'input_not_found' };
    }

    try {
      if (input.tagName === 'TEXTAREA') {
        // Native textarea — use prototype setter to trigger React's synthetic events
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          'value'
        ).set;
        nativeInputValueSetter.call(input, text);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        // contenteditable div (ChatGPT's ProseMirror editor)
        input.focus();
        // Select all existing content then replace with execCommand (safe, no HTML)
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, text);

        // Fallback: if execCommand didn't insert text, use textContent directly
        if (!input.textContent.trim()) {
          input.textContent = text;
          input.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
        }
      }
      input.focus();
      return { success: true };
    } catch (err) {
      return { success: false, reason: err.message };
    }
  }

  // ── MutationObserver for new messages ────────────────────────────────────

  function findConversationContainer() {
    return (
      document.querySelector('[data-message-author-role]')?.closest('[role="presentation"]') ||
      document.querySelector('main') ||
      document.body
    );
  }

  let lastMessageCount = 0;

  function startMutationObserver() {
    stopMutationObserver();

    const container = findConversationContainer();
    if (!container) return;

    const initial = document.querySelectorAll('[data-message-author-role]');
    lastMessageCount = initial.length;

    mutationObserver = new MutationObserver(() => {
      if (!panelOpen) return;
      const current = document.querySelectorAll('[data-message-author-role]');
      if (current.length > lastMessageCount) {
        lastMessageCount = current.length;
        chrome.runtime.sendMessage({ type: 'CONTEXT_STALE' }).catch(() => {});
      }
    });

    mutationObserver.observe(container, { childList: true, subtree: true });
  }

  function stopMutationObserver() {
    if (mutationObserver) {
      mutationObserver.disconnect();
      mutationObserver = null;
    }
  }
})();
