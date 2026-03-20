/**
 * sidepanel.js — Side panel UI logic
 */

'use strict';

// ── State ─────────────────────────────────────────────────────────────────

const state = {
  settings: null,         // loaded from chrome.storage.local
  context: null,          // { messages, tokenEstimate, truncated } from ChatGPT
  sideMessages: [],       // [{role, content}] — current side conversation
  streaming: false,       // whether a stream is in progress
  tabId: null,            // active ChatGPT tab ID
  windowId: null,         // window ID of the active tab
  apiPort: null,          // long-lived port for streaming
  panelPort: null,        // long-lived port for panel <-> background
  summaryVisible: false,
  pendingSelectedText: null,
};

// ── DOM refs ──────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const dom = {
  contextCard:              $('context-card'),
  contextHeader:            $('context-header'),
  contextToggleIcon:        $('context-toggle-icon'),
  contextSummary:           $('context-summary'),
  contextBody:              $('context-body'),
  contextMessages:          $('context-messages'),
  staleBanner:              $('stale-banner'),
  refreshContextBtn:        $('refresh-context-btn'),
  emptyState:               $('empty-state'),
  emptyStateMsg:            $('empty-state-msg'),
  emptySettingsBtn:         $('empty-settings-btn'),
  messagesArea:             $('messages-area'),
  summaryCard:              $('summary-card'),
  summaryGenerating:        $('summary-generating'),
  summaryTextarea:          $('summary-textarea'),
  summaryActions:           $('summary-actions'),
  pasteBtn:                 $('paste-summary-btn'),
  copyBtn:                  $('copy-summary-btn'),
  cancelSummaryBtn:         $('cancel-summary-btn'),
  bottomBar:                $('bottom-bar'),
  injectBtn:                $('inject-btn'),
  clearBtn:                 $('clear-btn'),
  inputArea:                $('input-area'),
  inputWrapper:             $('input-wrapper'),
  selectedTextChip:         $('selected-text-chip'),
  selectedTextChipLabel:    $('selected-text-chip-label'),
  selectedTextChipDismiss:  $('selected-text-chip-dismiss'),
  chatInput:                $('chat-input'),
  sendBtn:                  $('send-btn'),
  settingsBtn:              $('settings-btn'),
  toastContainer:           $('toast-container'),
};

// ── Port management ───────────────────────────────────────────────────────

let isFirstConnect = true;

function connectPanelPort() {
  if (!chrome.runtime?.id) return; // extension context invalidated — stop
  try {
    const port = chrome.runtime.connect({ name: 'sidepanel' });
    state.panelPort = port;
    port.onMessage.addListener(handleBackgroundPortMessage);
    port.onDisconnect.addListener(() => {
      state.panelPort = null;
      // SW may have restarted; reconnect to restore message routing
      setTimeout(connectPanelPort, 100);
    });
    if (state.tabId) {
      port.postMessage({ type: 'REGISTER_TAB', tabId: state.tabId, windowId: state.windowId });
    }
    // On reconnects (not first connect), check for pending text stashed while port was down
    if (!isFirstConnect && state.tabId && state.settings) {
      chrome.runtime.sendMessage({ type: 'GET_PENDING_TEXT', tabId: state.tabId })
        .then(resp => { if (resp?.text) handleSelectedText(resp.text); })
        .catch(() => {});
    }
    isFirstConnect = false;
  } catch { /* extension context invalidated */ }
}

// ── Session storage helpers ────────────────────────────────────────────────

async function loadStateFromSession(tabId) {
  const key = `tabState_${tabId}`;
  return new Promise(resolve => {
    chrome.storage.session.get(key, (r) => resolve(r[key] || null));
  });
}

function saveStateToSession() {
  if (!state.tabId) return;
  const key = `tabState_${state.tabId}`;
  chrome.storage.session.set({
    [key]: {
      context: state.context,
      sideMessages: state.sideMessages,
      summaryVisible: state.summaryVisible,
      pendingSelectedText: state.pendingSelectedText,
      contextExpanded: dom.contextBody?.classList.contains('expanded') || false,
    },
  });
}

let _saveDebounceTimer = null;
function saveStateDebounced() {
  clearTimeout(_saveDebounceTimer);
  _saveDebounceTimer = setTimeout(saveStateToSession, 300);
}

function restoreState(saved) {
  state.context = saved.context || null;
  state.sideMessages = saved.sideMessages || [];
  state.summaryVisible = saved.summaryVisible || false;
  state.pendingSelectedText = saved.pendingSelectedText || null;
}

function renderRestoredMessages(contextExpanded) {
  dom.messagesArea.textContent = '';
  enableChatUI();
  state.sideMessages.forEach(msg => appendMessage(msg.role, msg.content));
  if (state.context) {
    renderContextPreview();
    if (contextExpanded) {
      dom.contextBody.classList.add('expanded');
      dom.contextToggleIcon.classList.add('expanded');
      dom.contextHeader.setAttribute('aria-expanded', 'true');
    }
  }
  dom.injectBtn.disabled = state.sideMessages.length === 0;
  dom.clearBtn.disabled = state.sideMessages.length === 0;
  if (state.summaryVisible) dom.summaryCard.classList.add('visible');
  if (state.pendingSelectedText) {
    const truncated = state.pendingSelectedText.length > 50
      ? state.pendingSelectedText.slice(0, 50) + '…'
      : state.pendingSelectedText;
    dom.selectedTextChipLabel.textContent = `"${truncated}"`;
    dom.selectedTextChip.title = state.pendingSelectedText;
    dom.selectedTextChip.classList.remove('hidden');
  }
  scrollToBottom();
}

// ── Init ──────────────────────────────────────────────────────────────────

async function init() {
  // Connect long-lived port to background for CONTEXT_STALE notifications
  connectPanelPort();

  // Get active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.tabId = tab?.id || null;
  state.windowId = tab?.windowId || null;

  // Register tab with background (connectPanelPort was called before tabId was resolved)
  if (state.panelPort && state.tabId) {
    state.panelPort.postMessage({ type: 'REGISTER_TAB', tabId: state.tabId, windowId: state.windowId });
  }

  // Notify background that panel is ready (triggers PANEL_OPENED in content script)
  if (state.tabId) {
    chrome.runtime.sendMessage({ type: 'PANEL_READY', tabId: state.tabId }).catch(() => {});
  }

  // Load settings
  state.settings = await loadSettings();

  const hasKey = getActiveApiKey();

  if (!hasKey) {
    showEmptyState('no_api_key');
    return;
  }

  // Try to restore saved state for this tab
  const saved = state.tabId ? await loadStateFromSession(state.tabId) : null;
  if (saved && (saved.sideMessages?.length > 0 || saved.context)) {
    restoreState(saved);
    renderRestoredMessages(saved.contextExpanded);
    // Auto-refresh context; show banner if it changed
    const oldCount = state.context?.messages?.length || 0;
    await loadContext();
    if ((state.context?.messages?.length || 0) !== oldCount) {
      showStaleBanner();
    }
  } else {
    await loadContext();
  }

  // Wire events
  wireEvents();

  // Save state on visibility change (tab switch / panel close)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveStateToSession();
  });

  // Check for selected text that triggered this panel open
  if (state.tabId) {
    const pendingResp = await chrome.runtime.sendMessage({
      type: 'GET_PENDING_TEXT',
      tabId: state.tabId,
    }).catch(() => null);
    if (pendingResp?.text) {
      handleSelectedText(pendingResp.text);
    }
  }
}

// ── Settings ──────────────────────────────────────────────────────────────

async function loadSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(['apiKeys', 'defaultModel', 'maxContextMessages', 'summaryStyle'], result => {
      resolve({
        apiKeys: result.apiKeys || [],
        defaultModel: result.defaultModel || null,
        maxContextMessages: result.maxContextMessages || 20,
        summaryStyle: result.summaryStyle || 'concise',
      });
    });
  });
}

function getActiveApiKey() {
  if (!state.settings?.apiKeys?.length) return null;
  if (state.settings.defaultModel) {
    const [provider, model] = state.settings.defaultModel.split('|');
    const key = state.settings.apiKeys.find(k => k.provider === provider);
    if (key) return { apiKey: key.key, provider, model };
  }
  const first = state.settings.apiKeys[0];
  return first ? { apiKey: first.key, provider: first.provider, model: getDefaultModel(first.provider) } : null;
}

function getDefaultModel(provider) {
  return provider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o';
}

// ── Context loading ───────────────────────────────────────────────────────

async function loadContext() {
  dom.contextSummary.textContent = 'Reading conversation…';

  try {
    const resp = await chrome.runtime.sendMessage({
      type: 'GET_CONTEXT',
      tabId: state.tabId,
      maxPairs: state.settings.maxContextMessages,
    });

    if (!resp || !resp.success) {
      const errType = resp?.error || 'unknown';
      showContextError(errType);
      return;
    }

    if (!resp.messages || resp.messages.length === 0) {
      showContextError('no_messages');
      return;
    }

    state.context = {
      messages: resp.messages,
      tokenEstimate: resp.tokenEstimate,
      truncated: resp.truncated,
    };

    renderContextPreview();
    enableChatUI();
    hideStaleBanner();
  } catch (err) {
    showContextError('network');
  }
}

function renderContextPreview() {
  const { messages, truncated } = state.context;

  // Summary line
  const firstUserMsg = messages.find(m => m.role === 'user');
  const preview = firstUserMsg
    ? firstUserMsg.content.slice(0, 60).replace(/\n/g, ' ') + (firstUserMsg.content.length > 60 ? '…' : '')
    : 'Conversation loaded';
  dom.contextSummary.textContent = `${preview} (${messages.length} messages)`;

  // Full context messages
  dom.contextMessages.textContent = '';

  if (truncated) {
    const note = document.createElement('p');
    note.className = 'truncated-note';
    note.textContent = `[Showing last ${messages.length} messages — older messages omitted]`;
    dom.contextMessages.appendChild(note);
  }

  messages.forEach(m => {
    const msgEl = document.createElement('div');
    msgEl.className = `ctx-msg ctx-msg--${m.role}`;

    const contentEl = document.createElement('div');
    contentEl.className = 'ctx-msg-content';
    // renderMarkdown HTML-escapes all content before applying markdown tags — XSS-safe
    contentEl.innerHTML = renderMarkdown(m.content); // nosec: renderMarkdown pre-escapes HTML
    msgEl.appendChild(contentEl);
    dom.contextMessages.appendChild(msgEl);
  });
}

function showContextError(errType) {
  const messages = {
    no_messages: 'Start a conversation in ChatGPT first, then open SideChat.',
    no_chatgpt_tab: 'Navigate to chatgpt.com to use SideChat.',
    network: 'Couldn\'t read the ChatGPT conversation. Make sure you\'re on an active chat page and try refreshing.',
    unknown: 'Couldn\'t read the conversation. Try refreshing the page.',
  };
  dom.contextSummary.textContent = messages[errType] || messages.unknown;
  // Still allow chat in "no_messages" case (empty context)
  if (errType === 'no_messages') {
    state.context = { messages: [], tokenEstimate: 0, truncated: false };
    enableChatUI();
    dom.contextSummary.textContent = 'No conversation found — side-chat will work without context.';
  }
}

// ── Empty / error states ──────────────────────────────────────────────────

function showEmptyState(type) {
  dom.emptyState.classList.add('visible');
  dom.contextCard.classList.add('hidden');
  dom.messagesArea.classList.add('hidden');
  dom.bottomBar.classList.add('hidden');
  dom.inputArea.classList.add('hidden');

  if (type === 'no_api_key') {
    dom.emptyStateMsg.textContent = 'Add your API key in settings to get started.';
    dom.emptySettingsBtn.classList.remove('hidden');
    dom.emptySettingsBtn.onclick = () => SettingsPanel.open();
  } else if (type === 'no_chatgpt_tab') {
    dom.emptyStateMsg.textContent = 'Navigate to chatgpt.com to use SideChat.';
    dom.emptySettingsBtn.classList.add('hidden');
  }
}

// ── Chat UI ───────────────────────────────────────────────────────────────

function enableChatUI() {
  dom.emptyState.classList.remove('visible');
  dom.contextCard.classList.remove('hidden');
  dom.messagesArea.classList.remove('hidden');
  dom.bottomBar.classList.remove('hidden');
  dom.inputArea.classList.remove('hidden');
  dom.chatInput.disabled = false;
  dom.sendBtn.disabled = false;
  dom.chatInput.focus();
}

function setInputLocked(locked) {
  dom.chatInput.disabled = locked;
  dom.sendBtn.disabled = locked;
  dom.injectBtn.disabled = locked || state.sideMessages.length === 0;
  dom.clearBtn.disabled = locked || state.sideMessages.length === 0;
  state.streaming = locked;
}

// ── Sending messages ──────────────────────────────────────────────────────

async function sendMessage() {
  const inputText = dom.chatInput.value.trim();
  if (!inputText || state.streaming) return;

  const keyInfo = getActiveApiKey();
  if (!keyInfo) {
    showToast('No API key configured. Open settings to add one.', 'error');
    return;
  }

  const text = state.pendingSelectedText
    ? `"${state.pendingSelectedText}"\n\n${inputText}`
    : inputText;

  dom.chatInput.value = '';
  autoResizeTextarea();
  dismissSelectedTextChip();

  // Add user message to state and UI
  state.sideMessages.push({ role: 'user', content: text });
  appendMessage('user', text);
  scrollToBottom();
  saveStateDebounced();

  setInputLocked(true);

  // Build full messages array: system prompt + context + side messages
  const apiMessages = buildApiMessages();

  // Show typing indicator
  const typingEl = appendTypingIndicator();

  // Open stream port
  const port = chrome.runtime.connect({ name: 'api-stream' });
  state.apiPort = port;

  let assistantText = '';
  let assistantBubble = null;

  port.onMessage.addListener(msg => {
    if (msg.type === 'chunk') {
      if (!assistantBubble) {
        typingEl.remove();
        assistantBubble = appendMessage('assistant', '');
      }
      assistantText += msg.text;
      // Render markdown safely — HTML is escaped before markdown processing
      assistantBubble.querySelector('.bubble').innerHTML = renderMarkdown(assistantText);
      scrollToBottom();
    } else if (msg.type === 'done') {
      port.disconnect();
      state.apiPort = null;
      state.sideMessages.push({ role: 'assistant', content: assistantText });
      saveStateDebounced();
      setInputLocked(false);
      dom.injectBtn.disabled = false;
      dom.clearBtn.disabled = false;
      scrollToBottom();
    } else if (msg.type === 'error') {
      typingEl.remove();
      if (assistantBubble) assistantBubble.remove();
      port.disconnect();
      state.apiPort = null;
      setInputLocked(false);
      showToast(msg.message || 'Unknown error.', 'error');
    }
  });

  port.onDisconnect.addListener(() => {
    state.apiPort = null;
    if (state.streaming) {
      setInputLocked(false);
      typingEl.remove();
    }
  });

  port.postMessage({
    type: 'CHAT',
    tabId: state.tabId,
    messages: apiMessages,
    model: keyInfo.model,
    apiKey: keyInfo.apiKey,
    provider: keyInfo.provider,
  });
}

function buildApiMessages() {
  const systemContent = buildSystemPrompt();
  const msgs = [{ role: 'system', content: systemContent }];

  // Add context as initial messages if present
  if (state.context?.messages?.length) {
    msgs.push(...state.context.messages);
  }

  // Add side-chat history
  msgs.push(...state.sideMessages);

  return msgs;
}

function buildSystemPrompt() {
  if (!state.context?.messages?.length) {
    return 'You are a helpful assistant in a side-chat panel. Answer the user\'s questions concisely.';
  }
  const contextBlock = state.context.messages
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');
  const truncationNote = state.context.truncated
    ? '\n\n[Note: The conversation above is truncated. Only the most recent messages are shown.]'
    : '';
  return (
    'You are continuing a conversation as a helpful assistant. The user has opened a side-chat to explore a tangent. ' +
    'Below is the context from their main conversation for reference. ' +
    'Answer their side-question, staying focused on what they ask without trying to continue the main conversation thread.\n\n' +
    '--- Main Conversation Context ---\n\n' +
    contextBlock + truncationNote +
    '\n\n--- End of Context ---'
  );
}

// ── Message rendering ─────────────────────────────────────────────────────

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
    return `\x00CODE_BLOCK_${idx}\x00`;
  });

  // Step 2: Escape HTML in non-code content (split on placeholders to avoid double-escaping)
  html = html.split('\x00').map((part, i) => {
    // Odd-indexed parts are placeholder tokens like "CODE_BLOCK_0"
    if (i % 2 === 1 && part.startsWith('CODE_BLOCK_')) return '\x00' + part + '\x00';
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
    if (blockTagRe.test(seg) || seg.startsWith('\x00CODE_BLOCK_')) return seg;
    // Single newlines within a paragraph become <br>
    return `<p>${seg.replace(/\n/g, '<br>')}</p>`;
  }).filter(Boolean).join('\n');

  // Step 10: Restore fenced code blocks
  codeBlocks.forEach((block, i) => {
    html = html.replace(`\x00CODE_BLOCK_${i}\x00`, block);
  });

  return html;
}

function appendMessage(role, text) {
  const msgEl = document.createElement('div');
  msgEl.className = `message ${role}`;

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  if (role === 'assistant') {
    // renderMarkdown escapes all HTML before inserting tags — safe to use innerHTML
    bubble.innerHTML = renderMarkdown(text);
  } else {
    bubble.textContent = text;
  }

  msgEl.appendChild(bubble);
  dom.messagesArea.appendChild(msgEl);
  return msgEl;
}

function appendTypingIndicator() {
  const msgEl = document.createElement('div');
  msgEl.className = 'message assistant';
  const bubble = document.createElement('div');
  bubble.className = 'bubble typing-indicator';
  for (let i = 0; i < 3; i++) {
    const dot = document.createElement('span');
    dot.className = 'typing-dot';
    bubble.appendChild(dot);
  }
  msgEl.appendChild(bubble);
  dom.messagesArea.appendChild(msgEl);
  scrollToBottom();
  return msgEl;
}

function scrollToBottom() {
  dom.messagesArea.scrollTop = dom.messagesArea.scrollHeight;
}

// ── Inject Summary ────────────────────────────────────────────────────────

async function handleInjectSummary() {
  if (state.sideMessages.length === 0) return;
  const keyInfo = getActiveApiKey();
  if (!keyInfo) {
    showToast('No API key configured.', 'error');
    return;
  }

  dom.summaryCard.classList.add('visible');
  dom.summaryGenerating.classList.remove('hidden');
  dom.summaryTextarea.classList.add('hidden');
  dom.summaryActions.classList.add('hidden');
  dom.injectBtn.disabled = true;

  try {
    const resp = await chrome.runtime.sendMessage({
      type: 'GET_SUMMARY',
      messages: state.sideMessages,
      style: state.settings.summaryStyle,
      apiKey: keyInfo.apiKey,
      provider: keyInfo.provider,
      model: keyInfo.model,
    });

    dom.summaryGenerating.classList.add('hidden');

    if (!resp.success) {
      showToast(resp.error || 'Failed to generate summary.', 'error');
      dom.summaryCard.classList.remove('visible');
      dom.injectBtn.disabled = false;
      return;
    }

    dom.summaryTextarea.value = resp.text;
    dom.summaryTextarea.classList.remove('hidden');
    dom.summaryActions.classList.remove('hidden');
    state.summaryVisible = true;
  } catch (err) {
    showToast('Couldn\'t generate summary. Check your connection.', 'error');
    dom.summaryCard.classList.remove('visible');
    dom.injectBtn.disabled = false;
  }
}

async function handlePasteSummary() {
  const text = dom.summaryTextarea.value.trim();
  if (!text) return;

  const resp = await chrome.runtime.sendMessage({
    type: 'PASTE_SUMMARY',
    tabId: state.tabId,
    text,
  });

  if (resp?.success) {
    showToast('Summary pasted into ChatGPT. Press Enter in ChatGPT to send.', 'success');
    hideSummaryCard();
    dismissSelectedTextChip();
  } else {
    // Fallback: copy to clipboard
    try {
      await navigator.clipboard.writeText(text);
      showToast('Couldn\'t paste automatically. Summary copied to clipboard — paste it manually.', 'info');
    } catch {
      showToast('Couldn\'t paste or copy. Please copy the text manually.', 'error');
    }
    hideSummaryCard();
    dismissSelectedTextChip();
  }
}

async function handleCopySummary() {
  const text = dom.summaryTextarea.value.trim();
  try {
    await navigator.clipboard.writeText(text);
    showToast('Summary copied to clipboard.', 'success');
  } catch {
    showToast('Clipboard access denied.', 'error');
  }
}

function hideSummaryCard() {
  dom.summaryCard.classList.remove('visible');
  dom.summaryTextarea.value = '';
  dom.injectBtn.disabled = state.sideMessages.length === 0;
  state.summaryVisible = false;
}

function dismissSelectedTextChip() {
  state.pendingSelectedText = null;
  dom.selectedTextChip.classList.add('hidden');
  dom.selectedTextChipLabel.textContent = '';
  dom.selectedTextChip.title = '';
  dom.chatInput.value = '';
  autoResizeTextarea();
}

// ── Clear chat ────────────────────────────────────────────────────────────

function clearChat() {
  if (state.streaming) return;
  state.sideMessages = [];
  dom.messagesArea.textContent = '';
  dom.injectBtn.disabled = true;
  dom.clearBtn.disabled = true;
  hideSummaryCard();
  dismissSelectedTextChip();
  scrollToBottom();
  saveStateDebounced();
}

// ── Context stale handling ────────────────────────────────────────────────

let contextRefreshTimer = null;

function scheduleContextRefresh() {
  clearTimeout(contextRefreshTimer);
  contextRefreshTimer = setTimeout(loadContext, 1500);
}

function showStaleBanner() {
  dom.staleBanner.classList.add('visible');
}

function hideStaleBanner() {
  dom.staleBanner.classList.remove('visible');
}

// ── Background port messages ──────────────────────────────────────────────

function handleBackgroundPortMessage(msg) {
  if (msg.type === 'CONTEXT_STALE') {
    if (!state.streaming) {
      scheduleContextRefresh();
    }
  } else if (msg.type === 'NEW_CONVERSATION') {
    handleNewConversation(msg.isReload || false);
  } else if (msg.type === 'LOAD_CONTEXT') {
    loadContext();
  } else if (msg.type === 'SELECTED_TEXT') {
    handleSelectedText(msg.text);
  } else if (msg.type === 'TAB_ACTIVATED') {
    handleTabActivated(msg.tabId, msg.url);
  }
}

// ── New conversation detected ─────────────────────────────────────────────

let newConvInFlight = false;

async function handleNewConversation(isReload = false) {
  if (state.streaming) return; // don't interrupt an active stream
  if (newConvInFlight) return;
  newConvInFlight = true;
  try {
    // Clear session state for this tab (conversation changed)
    if (state.tabId) chrome.storage.session.remove(`tabState_${state.tabId}`);

    // Reset side-chat state
    state.sideMessages = [];
    state.context = null;
    dom.messagesArea.textContent = '';
    dom.injectBtn.disabled = true;
    dom.clearBtn.disabled = true;
    hideSummaryCard();
    hideStaleBanner();
    dismissSelectedTextChip();

    // Collapse context card and show loading indicator
    dom.contextBody.classList.remove('expanded');
    dom.contextToggleIcon.classList.remove('expanded');
    dom.contextHeader.setAttribute('aria-expanded', 'false');
    dom.contextSummary.textContent = 'New conversation — refreshing context…';
    dom.contextMessages.textContent = '';

    if (!isReload) {
      // SPA navigation: wait briefly for ChatGPT to finish rendering
      await new Promise(r => setTimeout(r, 600));
      await loadContext();
    }
    // isReload=true: LOAD_CONTEXT message triggers loadContext() once the page is ready
  } finally {
    newConvInFlight = false;
  }
}

// ── Tab activated (user switched browser tabs) ────────────────────────────

async function handleTabActivated(_newTabId, _url) {
  // With per-tab panels, Chrome unloads/reloads the panel per tab automatically.
  // Just save state so it can be restored when the panel reopens on this tab.
  saveStateToSession();
}

// ── Selected text from Ask SideChat ──────────────────────────────────────

function handleSelectedText(text) {
  if (!text) return;
  // Clear the side conversation when starting a fresh Ask SideChat mid-session
  if (state.sideMessages.length > 0 && !state.streaming) {
    state.sideMessages = [];
    dom.messagesArea.textContent = '';
    dom.injectBtn.disabled = true;
    dom.clearBtn.disabled = true;
    hideSummaryCard();
    hideStaleBanner();
  }
  state.pendingSelectedText = text;
  const truncated = text.length > 50 ? text.slice(0, 50) + '…' : text;
  dom.selectedTextChipLabel.textContent = `"${truncated}"`;
  dom.selectedTextChip.title = text;
  dom.selectedTextChip.classList.remove('hidden');
  dom.chatInput.value = '';
  autoResizeTextarea();
  // Position cursor at the end so user can type their question.
  // Use a small delay so the panel window has time to receive focus
  // before the focus() call is made (needed when the panel was just opened).
  setTimeout(() => {
    dom.chatInput.focus();
    dom.chatInput.setSelectionRange(dom.chatInput.value.length, dom.chatInput.value.length);
  }, 100);
}

// ── Toast ─────────────────────────────────────────────────────────────────

function showToast(message, type = 'info', duration = 4000) {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  dom.toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}

// ── Context toggle ────────────────────────────────────────────────────────

function toggleContextExpand() {
  const isExpanded = dom.contextBody.classList.contains('expanded');
  dom.contextBody.classList.toggle('expanded', !isExpanded);
  dom.contextToggleIcon.classList.toggle('expanded', !isExpanded);
  dom.contextHeader.setAttribute('aria-expanded', String(!isExpanded));
}

// ── Auto-resize textarea ──────────────────────────────────────────────────

function autoResizeTextarea() {
  const ta = dom.chatInput;
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
}

// ── Event wiring ──────────────────────────────────────────────────────────

function wireEvents() {
  // Settings button — opens inline settings panel
  dom.settingsBtn.addEventListener('click', () => SettingsPanel.open());

  // Context toggle
  dom.contextHeader.addEventListener('click', toggleContextExpand);
  dom.contextHeader.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleContextExpand(); }
  });

  // Refresh context
  dom.refreshContextBtn.addEventListener('click', async () => {
    hideStaleBanner();
    await loadContext();
  });

  // Send on Enter (Shift+Enter for newline)
  dom.chatInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Auto-resize
  dom.chatInput.addEventListener('input', autoResizeTextarea);

  // Send button
  dom.sendBtn.addEventListener('click', sendMessage);

  // Inject summary
  dom.injectBtn.addEventListener('click', handleInjectSummary);

  // Clear chat
  dom.clearBtn.addEventListener('click', clearChat);

  // Summary card
  dom.pasteBtn.addEventListener('click', handlePasteSummary);
  dom.copyBtn.addEventListener('click', handleCopySummary);
  dom.cancelSummaryBtn.addEventListener('click', hideSummaryCard);

  // Chip dismiss
  dom.selectedTextChipDismiss.addEventListener('click', dismissSelectedTextChip);

  // Empty state settings button
  dom.emptySettingsBtn.addEventListener('click', () => SettingsPanel.open());

  // Reload settings when storage changes (e.g., settings panel saved)
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local') return;
    state.settings = await loadSettings();
    const hasKey = getActiveApiKey();
    if (hasKey && dom.emptyState.classList.contains('visible')) {
      dom.emptyState.classList.remove('visible');
      dom.contextCard.classList.remove('hidden');
      dom.messagesArea.classList.remove('hidden');
      dom.bottomBar.classList.remove('hidden');
      await loadContext();
    }
  });
}

// ── Start ─────────────────────────────────────────────────────────────────

init().catch(err => {
  console.error('[SideChat] init error:', err);
});
