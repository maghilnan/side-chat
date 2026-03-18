/**
 * background.js — Service Worker
 * Handles: side panel lifecycle, context menu, message routing, API streaming
 */

importScripts('utils/api.js', 'utils/summarizer.js');

// ── Install: set up context menu ──────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'open-sidechat',
    title: 'Ask SideChat',
    contexts: ['selection'],
    documentUrlPatterns: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
  });
});

// ── Open side panel on icon click ────────────────────────────────────────

chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ tabId: tab.id });
});

// ── Open side panel on context menu click ────────────────────────────────

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'open-sidechat') {
    const selectedText = info.selectionText || '';
    const port = activePanelPorts.get(tab.id);
    if (port) {
      port.postMessage({ type: 'SELECTED_TEXT', text: selectedText });
    } else if (selectedText) {
      pendingSelectedTexts.set(tab.id, selectedText);
    }
    await chrome.sidePanel.open({ tabId: tab.id });
  }
});

// ── Track active side panel tabs for forwarding messages ─────────────────

const activePanelPorts = new Map(); // tabId → port
const panelPortsByWindow = new Map(); // windowId → port
const pendingSelectedTexts = new Map(); // tabId → selected text awaiting panel open

// ── Long-lived port for streaming ────────────────────────────────────────

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'api-stream') {
    handleStreamPort(port);
  } else if (port.name === 'sidepanel') {
    // Track which tab this side panel is for
    port.onMessage.addListener((msg) => {
      if (msg.type === 'REGISTER_TAB') {
        if (msg.prevTabId) activePanelPorts.delete(msg.prevTabId);
        activePanelPorts.set(msg.tabId, port);
        if (msg.windowId) panelPortsByWindow.set(msg.windowId, port);
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
      for (const [wId, p] of panelPortsByWindow.entries()) {
        if (p === port) { panelPortsByWindow.delete(wId); break; }
      }
    });
  }
});

// ── Tab lifecycle listeners ───────────────────────────────────────────────

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const port = activePanelPorts.get(tabId);
  if (!port) return;

  if (changeInfo.status === 'loading') {
    // Tab has started reloading — tell panel to clear immediately
    port.postMessage({ type: 'NEW_CONVERSATION', isReload: true });
  } else if (changeInfo.status === 'complete') {
    // Tab finished loading — re-register panel with the new content script
    const isChatGPT = tab.url?.includes('chatgpt.com') || tab.url?.includes('chat.openai.com');
    if (isChatGPT) {
      chrome.tabs.sendMessage(tabId, { type: 'PANEL_OPENED' }).catch(() => {});
      // Delay to give the injected content script time to initialize before loading context
      setTimeout(() => {
        const p = activePanelPorts.get(tabId);
        if (p) p.postMessage({ type: 'LOAD_CONTEXT' });
      }, 800);
    }
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  const port = panelPortsByWindow.get(windowId);
  if (!port) return;
  try {
    const tab = await chrome.tabs.get(tabId);
    port.postMessage({ type: 'TAB_ACTIVATED', tabId: tab.id, url: tab.url || '' });
  } catch {}
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
    chrome.sidePanel.open({ tabId }).catch(() => {});
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
