/**
 * background.js — Service Worker
 * Handles: side panel lifecycle, context menu, message routing, API streaming
 */

importScripts('utils/api.js', 'utils/summarizer.js');

// ── Per-tab panel tracking ─────────────────────────────────────────────────

const SIDE_PANEL_PATH = 'sidepanel/sidepanel.html';

function isSupportedTabUrl(url = '') {
  return url.startsWith('https://chatgpt.com/') || url.startsWith('https://chat.openai.com/');
}

async function setPanelEnabledForTab(tabId, url) {
  await chrome.sidePanel.setOptions({
    tabId,
    path: SIDE_PANEL_PATH,
    enabled: isSupportedTabUrl(url),
  });
}

async function syncExistingTabsPanelState() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs
      .filter(tab => typeof tab.id === 'number')
      .map(tab => setPanelEnabledForTab(tab.id, tab.url || ''))
  );
}

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => {
  console.error('[SideChat] Failed to enable side panel action click behavior:', error);
});

syncExistingTabsPanelState().catch((error) => {
  console.error('[SideChat] Failed to sync side panel state for existing tabs:', error);
});

// ── Install: set up context menu ──────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'open-sidechat',
    title: 'Ask SideChat',
    contexts: ['selection'],
    documentUrlPatterns: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
  });
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
    chrome.sidePanel.open({ tabId: tab.id }).catch((error) => {
      console.error('[SideChat] Failed to open side panel from context menu:', error);
    });
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
  if (changeInfo.url || changeInfo.status === 'complete') {
    setPanelEnabledForTab(tabId, tab.url || '').catch((error) => {
      console.error(`[SideChat] Failed to update panel state for tab ${tabId}:`, error);
    });
  }

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
  // Forward TAB_ACTIVATED to any connected panel port for this window
  const port = panelPortsByWindow.get(windowId);
  if (!port) return;
  try {
    const tab = await chrome.tabs.get(tabId);
    port.postMessage({ type: 'TAB_ACTIVATED', tabId: tab.id, url: tab.url || '' });
  } catch {}
});

chrome.tabs.onRemoved.addListener((tabId) => {
  activePanelPorts.delete(tabId);
  pendingSelectedTexts.delete(tabId);
  chrome.storage.session.remove(`tabState_${tabId}`);
});

async function handleStreamPort(port) {
  let disconnected = false;
  let tabId = null;
  let assistantText = '';

  port.onDisconnect.addListener(() => { disconnected = true; });

  port.onMessage.addListener(async (msg) => {
    if (msg.type !== 'CHAT') return;

    tabId = msg.tabId || null;
    const { messages, model, apiKey, provider } = msg;

    try {
      for await (const chunk of SidechatAPI.streamAPIResponse(provider, messages, model, apiKey)) {
        if (chunk.error) {
          if (!disconnected) port.postMessage({ type: 'error', message: chunk.error });
          return;
        }
        if (chunk.done) {
          if (!disconnected) {
            port.postMessage({ type: 'done' });
          } else if (tabId && assistantText) {
            // Panel closed mid-stream — save completed response to session storage
            await saveStreamResult(tabId, assistantText);
          }
          return;
        }
        if (chunk.text) {
          assistantText += chunk.text;
          if (!disconnected) port.postMessage({ type: 'chunk', text: chunk.text });
        }
      }
    } catch (err) {
      if (!disconnected) port.postMessage({ type: 'error', message: err.message || 'Unknown error during streaming.' });
      // If disconnected and errored, save whatever we got
      if (disconnected && tabId && assistantText) {
        await saveStreamResult(tabId, assistantText + '\n\n[Response interrupted by error]');
      }
    }
  });
}

async function saveStreamResult(tabId, text) {
  const key = `tabState_${tabId}`;
  const data = await chrome.storage.session.get(key);
  const tabState = data[key] || { sideMessages: [] };
  tabState.sideMessages = tabState.sideMessages || [];
  tabState.sideMessages.push({ role: 'assistant', content: text });
  await chrome.storage.session.set({ [key]: tabState });
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
    chrome.sidePanel.open({ tabId }).catch((error) => {
      console.error('[SideChat] Failed to open side panel from Ask SideChat:', error);
    });
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
