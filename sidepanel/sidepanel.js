/**
 * sidepanel.js — No-key side panel flow backed by the user's ChatGPT session.
 */

'use strict';

const state = {
  tabId: null,
  windowId: null,
  panelPort: null,
  context: null,
  pendingSelectedText: null,
  threadId: null,
  currentFrameUrl: null,
};

const $ = (id) => document.getElementById(id);

const dom = {
  contextHeader: $('context-header'),
  contextToggleIcon: $('context-toggle-icon'),
  contextSummary: $('context-summary'),
  contextBody: $('context-body'),
  contextMessages: $('context-messages'),
  staleBanner: $('stale-banner'),
  refreshContextBtn: $('refresh-context-btn'),
  selectionCard: $('selection-card'),
  selectionPreview: $('selection-preview'),
  emptyState: $('empty-state'),
  emptyStateMsg: $('empty-state-msg'),
  embedShell: $('embed-shell'),
  frame: $('chatgpt-frame'),
  frameOverlay: $('frame-overlay'),
  frameOverlayText: $('frame-overlay-text'),
};

let isFirstConnect = true;

init().catch((error) => {
  console.error('[SideChat] Failed to initialize side panel:', error);
  showEmptyState('Something went wrong while loading the side panel.');
});

async function init() {
  wireEvents();
  connectPanelPort();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.tabId = tab?.id || null;
  state.windowId = tab?.windowId || null;

  if (!state.tabId || !isSupportedUrl(tab?.url || '')) {
    showEmptyState('Open ChatGPT in the current window to use SideChat.');
    return;
  }

  registerCurrentTab();
  await chrome.runtime.sendMessage({ type: 'PANEL_READY', tabId: state.tabId }).catch(() => null);
  await loadContext();

  const pending = await chrome.runtime.sendMessage({
    type: 'GET_PENDING_TEXT',
    tabId: state.tabId,
  }).catch(() => null);

  if (pending?.text) {
    handleSelectedText(pending.text);
  } else {
    updateSelectionCard();
  }

  await startEmbeddedBranch();
}

function wireEvents() {
  dom.contextHeader.addEventListener('click', toggleContextCard);
  dom.refreshContextBtn.addEventListener('click', async () => {
    hideStaleBanner();
    await loadContext();
    await startEmbeddedBranch();
  });
  dom.frame.addEventListener('load', handleFrameLoad);
}

function connectPanelPort() {
  try {
    const port = chrome.runtime.connect({ name: 'sidepanel' });
    state.panelPort = port;
    port.onMessage.addListener(handleBackgroundPortMessage);
    port.onDisconnect.addListener(() => {
      state.panelPort = null;
      window.setTimeout(connectPanelPort, 150);
    });

    if (state.tabId) registerCurrentTab();

    if (!isFirstConnect && state.tabId) {
      chrome.runtime.sendMessage({ type: 'GET_PENDING_TEXT', tabId: state.tabId })
        .then((response) => {
          if (response?.text) handleSelectedText(response.text);
        })
        .catch(() => {});
    }

    isFirstConnect = false;
  } catch {
    // Ignore extension invalidation during reload.
  }
}

function registerCurrentTab(prevTabId = null) {
  if (!state.panelPort || !state.tabId) return;
  state.panelPort.postMessage({
    type: 'REGISTER_TAB',
    tabId: state.tabId,
    prevTabId,
    windowId: state.windowId,
  });
}

function handleBackgroundPortMessage(message) {
  if (message.type === 'SELECTED_TEXT') {
    handleSelectedText(message.text || '');
    startEmbeddedBranch().catch(() => {});
    return;
  }

  if (message.type === 'CONTEXT_STALE') {
    showStaleBanner();
    return;
  }

  if (message.type === 'NEW_CONVERSATION') {
    hideStaleBanner();
    loadContext().then(() => startEmbeddedBranch()).catch(() => {});
    return;
  }

  if (message.type === 'LOAD_CONTEXT') {
    loadContext().then(() => startEmbeddedBranch()).catch(() => {});
    return;
  }

  if (message.type === 'TAB_ACTIVATED') {
    handleTabActivated(message).catch(() => {});
  }
}

async function handleTabActivated(message) {
  if (!isSupportedUrl(message.url || '')) {
    state.tabId = message.tabId || null;
    state.windowId = null;
    showEmptyState('Switch back to a ChatGPT tab to keep using SideChat.');
    return;
  }

  const previousTabId = state.tabId;
  const tab = await chrome.tabs.get(message.tabId);
  state.tabId = tab.id;
  state.windowId = tab.windowId;
  registerCurrentTab(previousTabId);
  await chrome.runtime.sendMessage({ type: 'PANEL_READY', tabId: state.tabId }).catch(() => null);
  await loadContext();

  const pending = await chrome.runtime.sendMessage({
    type: 'GET_PENDING_TEXT',
    tabId: state.tabId,
  }).catch(() => null);

  state.pendingSelectedText = pending?.text || null;
  updateSelectionCard();
  await startEmbeddedBranch();
}

async function loadContext() {
  dom.contextSummary.textContent = 'Reading conversation…';

  const response = await chrome.runtime.sendMessage({
    type: 'GET_CONTEXT',
    tabId: state.tabId,
    maxPairs: 20,
  }).catch(() => null);

  if (!response?.success) {
    showEmptyState('Could not read the active ChatGPT conversation. Refresh the page and try again.');
    return;
  }

  if (!response.messages || response.messages.length === 0) {
    state.context = { messages: [], tokenEstimate: 0, truncated: false };
    dom.contextSummary.textContent = 'No conversation context found. A blank temporary chat will still open.';
    dom.contextMessages.textContent = '';
    showShell();
    return;
  }

  state.context = {
    messages: response.messages,
    tokenEstimate: response.tokenEstimate,
    truncated: response.truncated,
  };

  renderContextPreview();
  showShell();
}

function renderContextPreview() {
  const messages = state.context?.messages || [];
  const firstUserMessage = messages.find((message) => message.role === 'user');
  const preview = firstUserMessage
    ? truncate(firstUserMessage.content.replace(/\s+/g, ' '), 72)
    : 'Conversation loaded';

  dom.contextSummary.textContent = `${preview} (${messages.length} messages)`;
  dom.contextMessages.textContent = '';

  if (state.context?.truncated) {
    const note = document.createElement('p');
    note.className = 'ctx-msg';
    note.textContent = 'Showing the latest messages only. Older turns were omitted.';
    dom.contextMessages.appendChild(note);
  }

  messages.forEach((message) => {
    const node = document.createElement('div');
    node.className = `ctx-msg ctx-msg--${message.role}`;
    node.textContent = message.content;
    dom.contextMessages.appendChild(node);
  });
}

function updateSelectionCard() {
  if (!state.pendingSelectedText) {
    dom.selectionCard.classList.add('hidden');
    dom.selectionPreview.textContent = '';
    return;
  }

  dom.selectionCard.classList.remove('hidden');
  dom.selectionPreview.textContent = state.pendingSelectedText;
}

function handleSelectedText(text) {
  state.pendingSelectedText = text || null;
  updateSelectionCard();
}

async function startEmbeddedBranch() {
  showShell();
  showFrameOverlay('Opening a fresh temporary ChatGPT branch…');

  state.threadId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const prompt = buildThreadPrompt();
  await chrome.runtime.sendMessage({
    type: 'SET_THREAD_CONTEXT',
    threadId: state.threadId,
    text: prompt,
  });

  state.currentFrameUrl = `https://chatgpt.com/?temporary-chat=true#sidechat-thread-${state.threadId}`;
  dom.frame.src = state.currentFrameUrl;
}

function buildThreadPrompt() {
  const selected = state.pendingSelectedText?.trim();
  const contextMessages = state.context?.messages || [];
  const tail = contextMessages.slice(-4);

  if (!selected && tail.length === 0) {
    return '';
  }

  const parts = [
    'I opened this temporary side chat from another ChatGPT conversation.',
  ];

  if (selected) {
    parts.push(`Selected excerpt:\n"""\n${selected}\n"""`);
  }

  if (tail.length > 0) {
    const contextBlock = tail
      .map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}`)
      .join('\n\n');
    parts.push(`Recent conversation context:\n${contextBlock}`);
  }

  parts.push('Please help me explore this tangent while keeping the answer grounded in that context.');
  return parts.join('\n\n');
}

function handleFrameLoad() {
  hideFrameOverlay();
}

function toggleContextCard() {
  const expanded = dom.contextBody.classList.toggle('expanded');
  dom.contextToggleIcon.classList.toggle('expanded', expanded);
  dom.contextHeader.setAttribute('aria-expanded', expanded ? 'true' : 'false');
}

function showShell() {
  dom.emptyState.classList.remove('visible');
  dom.embedShell.classList.remove('hidden');
}

function showEmptyState(message) {
  dom.emptyState.classList.add('visible');
  dom.emptyStateMsg.textContent = message;
  dom.embedShell.classList.add('hidden');
  dom.selectionCard.classList.add('hidden');
}

function showStaleBanner() {
  dom.staleBanner.classList.add('visible');
}

function hideStaleBanner() {
  dom.staleBanner.classList.remove('visible');
}

function showFrameOverlay(message) {
  dom.frameOverlayText.textContent = message;
  dom.frameOverlay.classList.remove('hidden');
}

function hideFrameOverlay() {
  dom.frameOverlay.classList.add('hidden');
}

function isSupportedUrl(url) {
  return url.startsWith('https://chatgpt.com/') || url.startsWith('https://chat.openai.com/');
}

function truncate(text, maxLength) {
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}
