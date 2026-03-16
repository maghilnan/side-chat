/**
 * background.js — Service Worker
 * Handles: side panel lifecycle, context menu, message routing, API streaming
 */

importScripts('utils/api.js', 'utils/summarizer.js');

// ── Install: set up context menu ──────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'open-sidechat',
    title: 'Open SideChat',
    contexts: ['page', 'selection'],
    documentUrlPatterns: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
  });
});

// ── Helper: detect ChatGPT tabs ──────────────────────────────────────────

function isChatGPTTab(url) {
  return url?.includes('chatgpt.com') || url?.includes('chat.openai.com');
}

// ── Open side panel on icon click ────────────────────────────────────────

chrome.action.onClicked.addListener(async (tab) => {
  if (isChatGPTTab(tab.url)) {
    await chrome.sidePanel.setOptions({ tabId: tab.id, enabled: true });
    await chrome.sidePanel.open({ tabId: tab.id });
  }
});

// ── Open side panel on context menu click ────────────────────────────────

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'open-sidechat') {
    await chrome.sidePanel.setOptions({ tabId: tab.id, enabled: true });
    await chrome.sidePanel.open({ tabId: tab.id });
  }
});

// ── Track active side panel tabs for forwarding messages ─────────────────

const activePanelPorts = new Map(); // tabId → port
const pendingSelectedTexts = new Map(); // tabId → selected text awaiting panel open

// ── Long-lived port for streaming ────────────────────────────────────────

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'api-stream') {
    handleStreamPort(port);
  } else if (port.name === 'sidepanel') {
    // Track which tab this side panel is for
    port.onMessage.addListener((msg) => {
      if (msg.type === 'REGISTER_TAB') {
        activePanelPorts.set(msg.tabId, port);
      }
    });
    port.onDisconnect.addListener(() => {
      for (const [tabId, p] of activePanelPorts.entries()) {
        if (p === port) {
          activePanelPorts.delete(tabId);
          // Notify content script panel is closed
          chrome.tabs.sendMessage(tabId, { type: 'PANEL_CLOSED' }).catch(() => {});
          break;
        }
      }
    });
  }
});

async function handleStreamPort(port) {
  port.onMessage.addListener(async (msg) => {
    if (msg.type !== 'CHAT') return;

    const { messages, model, apiKey, provider } = msg;

    try {
      for await (const chunk of SidechatAPI.streamAPIResponse(provider, messages, model, apiKey)) {
        if (chunk.error) {
          port.postMessage({ type: 'error', message: chunk.error });
          return;
        }
        if (chunk.done) {
          port.postMessage({ type: 'done' });
          return;
        }
        if (chunk.text) {
          port.postMessage({ type: 'chunk', text: chunk.text });
        }
      }
    } catch (err) {
      port.postMessage({ type: 'error', message: err.message || 'Unknown error during streaming.' });
    }
  });
}

// ── Regular message handlers ──────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Forward content-script events to the side panel port for that tab
  if (message.type === 'CONTEXT_STALE' || message.type === 'NEW_CONVERSATION') {
    const tabId = sender.tab?.id;
    if (tabId) {
      const port = activePanelPorts.get(tabId);
      if (port) port.postMessage({ type: message.type });
    }
    return false;
  }

  if (message.type === 'ASK_SIDECHAT') {
    const tabId = sender.tab?.id;
    if (!tabId) return false;
    const selectedText = message.selectedText || '';
    const port = activePanelPorts.get(tabId);
    if (port) {
      // Panel already open — deliver directly
      port.postMessage({ type: 'SELECTED_TEXT', text: selectedText });
    } else {
      // Panel not open — stash text, open panel; panel will fetch it on init
      pendingSelectedTexts.set(tabId, selectedText);
    }
    chrome.sidePanel.setOptions({ tabId, enabled: true })
      .then(() => chrome.sidePanel.open({ tabId }))
      .catch(() => {});
    return false;
  }

  if (message.type === 'GET_PENDING_TEXT') {
    const tabId = message.tabId;
    const text = pendingSelectedTexts.get(tabId) || null;
    if (text) pendingSelectedTexts.delete(tabId);
    sendResponse({ text });
    return true;
  }

  if (message.type === 'GET_CONTEXT') {
    handleGetContext(message, sender, sendResponse);
    return true; // async
  }

  if (message.type === 'PASTE_SUMMARY') {
    handlePasteSummary(message, sender, sendResponse);
    return true;
  }

  if (message.type === 'GET_SUMMARY') {
    handleGetSummary(message, sendResponse);
    return true;
  }

  if (message.type === 'PANEL_READY') {
    // Panel just opened — notify content script
    const tabId = message.tabId;
    if (tabId) {
      chrome.tabs.sendMessage(tabId, { type: 'PANEL_OPENED' }).catch(() => {});
    }
    sendResponse({ success: true });
    return true;
  }
});

// ── Handler implementations ───────────────────────────────────────────────

async function handleGetContext(message, sender, sendResponse) {
  try {
    // Find the active chatgpt.com tab
    const tabId = message.tabId || (await getActiveChatGPTTab());
    if (!tabId) {
      sendResponse({ success: false, error: 'no_chatgpt_tab' });
      return;
    }

    const maxPairs = message.maxPairs || 20;
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'READ_CONTEXT',
      maxPairs,
    });
    sendResponse(response);
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

async function handlePasteSummary(message, sender, sendResponse) {
  try {
    const tabId = message.tabId || (await getActiveChatGPTTab());
    if (!tabId) {
      sendResponse({ success: false, reason: 'no_chatgpt_tab' });
      return;
    }
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'PASTE_TEXT',
      text: message.text,
    });
    sendResponse(response);
  } catch (err) {
    sendResponse({ success: false, reason: err.message });
  }
}

async function handleGetSummary(message, sendResponse) {
  const { messages: sideChatMessages, style, apiKey, provider, model } = message;
  try {
    const summaryMessages = SidechatSummarizer.buildSummaryMessages(sideChatMessages, style);
    const text = await SidechatAPI.callAPI(provider, summaryMessages, model, apiKey);
    sendResponse({ success: true, text });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

async function getActiveChatGPTTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const chatTab = tabs.find(
    t => t.url?.includes('chatgpt.com') || t.url?.includes('chat.openai.com')
  );
  return chatTab?.id || null;
}

// ── Auto-enable/disable side panel based on active tab URL ────────────────

async function updatePanelForTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    await chrome.sidePanel.setOptions({
      tabId,
      enabled: isChatGPTTab(tab.url),
    });
  } catch (e) {
    // Tab may have been closed
  }
}

chrome.tabs.onActivated.addListener(({ tabId }) => {
  updatePanelForTab(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    updatePanelForTab(tabId);
  }
});
