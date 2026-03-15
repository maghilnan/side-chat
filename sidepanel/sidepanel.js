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
  apiPort: null,          // long-lived port for streaming
  panelPort: null,        // long-lived port for panel <-> background
  summaryVisible: false,
};

// ── DOM refs ──────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const dom = {
  contextCard:       $('context-card'),
  contextHeader:     $('context-header'),
  contextToggleIcon: $('context-toggle-icon'),
  contextSummary:    $('context-summary'),
  contextTokenCount: $('context-token-count'),
  contextBody:       $('context-body'),
  contextMessages:   $('context-messages'),
  staleBanner:       $('stale-banner'),
  refreshContextBtn: $('refresh-context-btn'),
  emptyState:        $('empty-state'),
  emptyStateMsg:     $('empty-state-msg'),
  emptySettingsBtn:  $('empty-settings-btn'),
  messagesArea:      $('messages-area'),
  summaryCard:       $('summary-card'),
  summaryGenerating: $('summary-generating'),
  summaryTextarea:   $('summary-textarea'),
  summaryActions:    $('summary-actions'),
  pasteBtn:          $('paste-summary-btn'),
  copyBtn:           $('copy-summary-btn'),
  cancelSummaryBtn:  $('cancel-summary-btn'),
  actionBar:         $('action-bar'),
  injectBtn:         $('inject-btn'),
  clearBtn:          $('clear-btn'),
  chatInput:         $('chat-input'),
  sendBtn:           $('send-btn'),
  modelSelect:       $('model-select'),
  settingsBtn:       $('settings-btn'),
  toastContainer:    $('toast-container'),
};

// ── Init ──────────────────────────────────────────────────────────────────

async function init() {
  // Connect long-lived port to background for CONTEXT_STALE notifications
  state.panelPort = chrome.runtime.connect({ name: 'sidepanel' });
  state.panelPort.onMessage.addListener(handleBackgroundPortMessage);
  state.panelPort.onDisconnect.addListener(() => { state.panelPort = null; });

  // Get active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.tabId = tab?.id || null;

  // Register tab with background
  if (state.panelPort && state.tabId) {
    state.panelPort.postMessage({ type: 'REGISTER_TAB', tabId: state.tabId });
  }

  // Notify background that panel is ready (triggers PANEL_OPENED in content script)
  if (state.tabId) {
    chrome.runtime.sendMessage({ type: 'PANEL_READY', tabId: state.tabId }).catch(() => {});
  }

  // Load settings
  state.settings = await loadSettings();
  populateModelDropdown();

  const hasKey = getActiveApiKey();

  if (!hasKey) {
    showEmptyState('no_api_key');
    return;
  }

  // Load context
  await loadContext();

  // Wire events
  wireEvents();

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
  const selected = dom.modelSelect.value;
  if (selected) {
    const [provider, model] = selected.split('|');
    const key = state.settings.apiKeys.find(k => k.provider === provider);
    if (key) return { apiKey: key.key, provider, model };
  }
  const first = state.settings.apiKeys[0];
  return first ? { apiKey: first.key, provider: first.provider, model: first.defaultModel || getDefaultModel(first.provider) } : null;
}

function getDefaultModel(provider) {
  return provider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o';
}

function populateModelDropdown() {
  dom.modelSelect.textContent = '';
  const keys = state.settings?.apiKeys || [];
  if (!keys.length) {
    const opt = document.createElement('option');
    opt.textContent = 'No API key';
    dom.modelSelect.appendChild(opt);
    return;
  }
  keys.forEach(k => {
    const models = k.provider === 'anthropic'
      ? ['claude-sonnet-4-20250514', 'claude-opus-4-5', 'claude-haiku-4-5-20251001']
      : ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'];
    models.forEach(m => {
      const opt = document.createElement('option');
      opt.value = `${k.provider}|${m}`;
      opt.textContent = m;
      if (state.settings.defaultModel === `${k.provider}|${m}`) opt.selected = true;
      dom.modelSelect.appendChild(opt);
    });
  });
}

// ── Context loading ───────────────────────────────────────────────────────

async function loadContext() {
  dom.contextSummary.textContent = 'Reading conversation…';
  dom.contextTokenCount.textContent = '';

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
  const { messages, tokenEstimate, truncated } = state.context;

  // Summary line
  const firstUserMsg = messages.find(m => m.role === 'user');
  const preview = firstUserMsg
    ? firstUserMsg.content.slice(0, 60).replace(/\n/g, ' ') + (firstUserMsg.content.length > 60 ? '…' : '')
    : 'Conversation loaded';
  dom.contextSummary.textContent = `${preview} (${messages.length} messages)`;

  // Token count
  const tokenK = (tokenEstimate / 1000).toFixed(1);
  dom.contextTokenCount.textContent = `~${tokenK}K tokens`;

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
    msgEl.className = 'ctx-msg';

    const roleEl = document.createElement('div');
    roleEl.className = 'ctx-msg-role';
    roleEl.textContent = m.role === 'user' ? 'You' : 'Assistant';

    const contentEl = document.createElement('div');
    contentEl.className = 'ctx-msg-content';
    contentEl.textContent = m.content;

    msgEl.appendChild(roleEl);
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
  dom.contextTokenCount.textContent = '';
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
  dom.actionBar.classList.add('hidden');
  dom.inputArea?.classList.add('hidden');

  if (type === 'no_api_key') {
    dom.emptyStateMsg.textContent = 'Add your API key in settings to get started.';
    dom.emptySettingsBtn.classList.remove('hidden');
    dom.emptySettingsBtn.onclick = () => chrome.runtime.openOptionsPage();
  }
}

// ── Chat UI ───────────────────────────────────────────────────────────────

function enableChatUI() {
  dom.emptyState.classList.remove('visible');
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
  const text = dom.chatInput.value.trim();
  if (!text || state.streaming) return;

  const keyInfo = getActiveApiKey();
  if (!keyInfo) {
    showToast('No API key configured. Open settings to add one.', 'error');
    return;
  }

  dom.chatInput.value = '';
  autoResizeTextarea();

  // Add user message to state and UI
  state.sideMessages.push({ role: 'user', content: text });
  appendMessage('user', text);
  scrollToBottom();

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
      // Render text safely
      assistantBubble.querySelector('.bubble').textContent = assistantText;
      scrollToBottom();
    } else if (msg.type === 'done') {
      port.disconnect();
      state.apiPort = null;
      state.sideMessages.push({ role: 'assistant', content: assistantText });
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

function appendMessage(role, text) {
  const msgEl = document.createElement('div');
  msgEl.className = `message ${role}`;

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;

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
  } else {
    // Fallback: copy to clipboard
    try {
      await navigator.clipboard.writeText(text);
      showToast('Couldn\'t paste automatically. Summary copied to clipboard — paste it manually.', 'info');
    } catch {
      showToast('Couldn\'t paste or copy. Please copy the text manually.', 'error');
    }
    hideSummaryCard();
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

// ── Clear chat ────────────────────────────────────────────────────────────

function clearChat() {
  if (state.streaming) return;
  state.sideMessages = [];
  dom.messagesArea.textContent = '';
  dom.injectBtn.disabled = true;
  dom.clearBtn.disabled = true;
  hideSummaryCard();
  scrollToBottom();
}

// ── Context stale handling ────────────────────────────────────────────────

function showStaleBanner() {
  dom.staleBanner.classList.add('visible');
}

function hideStaleBanner() {
  dom.staleBanner.classList.remove('visible');
}

// ── Background port messages ──────────────────────────────────────────────

function handleBackgroundPortMessage(msg) {
  if (msg.type === 'CONTEXT_STALE') {
    showStaleBanner();
  } else if (msg.type === 'NEW_CONVERSATION') {
    handleNewConversation();
  } else if (msg.type === 'SELECTED_TEXT') {
    handleSelectedText(msg.text);
  }
}

// ── New conversation detected ─────────────────────────────────────────────

async function handleNewConversation() {
  if (state.streaming) return; // don't interrupt an active stream

  // Reset side-chat state
  state.sideMessages = [];
  state.context = null;
  dom.messagesArea.textContent = '';
  dom.injectBtn.disabled = true;
  dom.clearBtn.disabled = true;
  hideSummaryCard();
  hideStaleBanner();

  // Collapse context card and show loading indicator
  dom.contextBody.classList.remove('expanded');
  dom.contextToggleIcon.classList.remove('expanded');
  dom.contextHeader.setAttribute('aria-expanded', 'false');
  dom.contextSummary.textContent = 'New conversation — refreshing context…';
  dom.contextTokenCount.textContent = '';
  dom.contextMessages.textContent = '';

  // Wait briefly for ChatGPT's SPA to finish rendering the new page
  await new Promise(r => setTimeout(r, 600));
  await loadContext();
}

// ── Selected text from Ask SideChat ──────────────────────────────────────

function handleSelectedText(text) {
  if (!text) return;
  // Pre-populate the input with a quote of the selected passage
  dom.chatInput.value = `"${text}"\n\n`;
  autoResizeTextarea();
  // Position cursor at the end so user can type their question
  dom.chatInput.focus();
  dom.chatInput.setSelectionRange(dom.chatInput.value.length, dom.chatInput.value.length);
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
  // Settings button
  dom.settingsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());

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

  // Empty state settings
  dom.emptySettingsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());

  // Model dropdown change
  dom.modelSelect.addEventListener('change', () => {
    // Model changed — nothing to persist per-session, just use the new value on next send
  });

  // Reload settings when storage changes (e.g., options page saved)
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local') return;
    state.settings = await loadSettings();
    populateModelDropdown();
    const hasKey = getActiveApiKey();
    if (hasKey && dom.emptyState.classList.contains('visible')) {
      dom.emptyState.classList.remove('visible');
      dom.contextCard.classList.remove('hidden');
      dom.messagesArea.classList.remove('hidden');
      dom.actionBar.classList.remove('hidden');
      await loadContext();
    }
  });
}

// ── Start ─────────────────────────────────────────────────────────────────

init().catch(err => {
  console.error('[SideChat] init error:', err);
});
