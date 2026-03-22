/**
 * background.js — Service worker
 * Handles side panel lifecycle, context handoff, and thread bootstrapping.
 */

'use strict';

const SIDE_PANEL_PATH = 'sidepanel/sidepanel.html';

const activePanelPorts = new Map(); // tabId -> port
const panelPortsByWindow = new Map(); // windowId -> port
const pendingSelectedTexts = new Map(); // tabId -> selected text awaiting panel open
const pendingThreadContexts = new Map(); // threadId -> prompt text for embedded ChatGPT frame

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

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'open-sidechat',
    title: 'Open SideChat Branch',
    contexts: ['selection'],
    documentUrlPatterns: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'open-sidechat' || typeof tab?.id !== 'number') return;

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
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'sidepanel') return;

  port.onMessage.addListener((msg) => {
    if (msg.type === 'REGISTER_TAB') {
      if (msg.prevTabId) activePanelPorts.delete(msg.prevTabId);
      activePanelPorts.set(msg.tabId, port);
      if (msg.windowId) panelPortsByWindow.set(msg.windowId, port);
    }
  });

  port.onDisconnect.addListener(() => {
    for (const [tabId, registeredPort] of activePanelPorts.entries()) {
      if (registeredPort === port) {
        activePanelPorts.delete(tabId);
        chrome.tabs.sendMessage(tabId, { type: 'PANEL_CLOSED' }).catch(() => {});
      }
    }

    for (const [windowId, registeredPort] of panelPortsByWindow.entries()) {
      if (registeredPort === port) panelPortsByWindow.delete(windowId);
    }
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    setPanelEnabledForTab(tabId, tab.url || '').catch((error) => {
      console.error(`[SideChat] Failed to update panel state for tab ${tabId}:`, error);
    });
  }

  const port = activePanelPorts.get(tabId);
  if (!port) return;

  if (changeInfo.status === 'loading') {
    port.postMessage({ type: 'NEW_CONVERSATION', isReload: true });
  } else if (changeInfo.status === 'complete' && isSupportedTabUrl(tab.url || '')) {
    chrome.tabs.sendMessage(tabId, { type: 'PANEL_OPENED' }).catch(() => {});
    setTimeout(() => {
      const refreshedPort = activePanelPorts.get(tabId);
      if (refreshedPort) refreshedPort.postMessage({ type: 'LOAD_CONTEXT' });
    }, 800);
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  const port = panelPortsByWindow.get(windowId);
  if (!port) return;

  try {
    const tab = await chrome.tabs.get(tabId);
    port.postMessage({ type: 'TAB_ACTIVATED', tabId: tab.id, url: tab.url || '' });
  } catch {
    // Ignore race with tab closing.
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  activePanelPorts.delete(tabId);
  pendingSelectedTexts.delete(tabId);
  chrome.storage.session.remove(`tabState_${tabId}`);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
      port.postMessage({ type: 'SELECTED_TEXT', text: selectedText });
    } else if (selectedText) {
      pendingSelectedTexts.set(tabId, selectedText);
    }

    chrome.sidePanel.open({ tabId }).catch((error) => {
      console.error('[SideChat] Failed to open side panel from Ask SideChat:', error);
    });
    return false;
  }

  if (message.type === 'GET_PENDING_TEXT') {
    const text = pendingSelectedTexts.get(message.tabId) || null;
    if (text) pendingSelectedTexts.delete(message.tabId);
    sendResponse({ text });
    return true;
  }

  if (message.type === 'SET_THREAD_CONTEXT') {
    pendingThreadContexts.set(message.threadId, message.text || '');
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'GET_THREAD_CONTEXT') {
    sendResponse({ text: pendingThreadContexts.get(message.threadId) || '' });
    return true;
  }

  if (message.type === 'CLEAR_THREAD_CONTEXT') {
    pendingThreadContexts.delete(message.threadId);
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'GET_CONTEXT') {
    handleGetContext(message, sendResponse);
    return true;
  }

  if (message.type === 'PANEL_READY') {
    const tabId = message.tabId;
    if (tabId) {
      chrome.tabs.sendMessage(tabId, { type: 'PANEL_OPENED' }).catch(() => {});
    }
    sendResponse({ success: true });
    return true;
  }

  return false;
});

async function handleGetContext(message, sendResponse) {
  try {
    const tabId = message.tabId || (await getActiveChatGPTTab());
    if (!tabId) {
      sendResponse({ success: false, error: 'no_chatgpt_tab' });
      return;
    }

    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'READ_CONTEXT',
      maxPairs: message.maxPairs || 20,
    });
    sendResponse(response);
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function getActiveChatGPTTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const chatTab = tabs.find(tab => isSupportedTabUrl(tab.url || ''));
  return chatTab?.id || null;
}
