# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**SideChat** is a Chrome Extension (Manifest V3) that enables ephemeral side-conversations while using ChatGPT. Users can explore tangents without polluting their main conversation — context is captured from the active ChatGPT tab, side-chat messages are kept separate, and an optional summary can be injected back into the main conversation.

## Development Setup

No build step, no dependencies, no package manager. Load directly as an unpacked Chrome extension:

1. Go to `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" → select this directory
4. After edits: click the refresh icon on the extension card (or use `Cmd+R` in DevTools)

## Architecture

### Component Map

| File | Role |
|------|------|
| `background.js` | Service worker — central message router, API call handler, port manager |
| `content-script.js` | Injected into chatgpt.com — reads DOM, detects changes, injects "Ask SideChat" button |
| `sidepanel/sidepanel.js` | Main UI controller for the side panel |
| `sidepanel/settings.js` | Settings UI logic for the side panel settings overlay |
| `utils/api.js` | OpenAI & Anthropic API wrappers with streaming support |
| `utils/dom-reader.js` | ChatGPT DOM parser with 3-tier fallback strategies |
| `utils/summarizer.js` | Builds system/user prompts for summary generation |
| `options/options.js` | Settings page (opens in tab) — API key management and preferences |

### Streaming Architecture

The extension uses long-lived Chrome ports for streaming:

1. `sidepanel.js` calls `chrome.runtime.connect({name: 'api-stream'})` when user sends a message
2. `background.js` receives the port, makes a `fetch()` to OpenAI/Anthropic, and pipes `ReadableStream` chunks via `port.postMessage()`
3. `sidepanel.js` listens on `port.onMessage` and renders chunks as they arrive

A separate persistent port (`name: 'sidepanel'`) lets background notify the side panel of context changes and lifecycle events.

### Port Names

| Name | Lifetime | Purpose |
|------|----------|---------|
| `sidepanel` | Persistent | Panel ↔ background: notifications, lifecycle events, state sync |
| `api-stream` | Per-message | Panel → background → API: streaming response delivery |

### Context Capture Flow

1. `sidepanel.js` sends `GET_CONTEXT` → `background.js` → forwards to `content-script.js`
2. `content-script.js` calls `dom-reader.js` to extract conversation from ChatGPT DOM
3. Returns `{messages, tokenEstimate, truncated}` back up the chain
4. `sidepanel.js` renders a collapsible context preview

### Stale Context Detection

A `MutationObserver` in `content-script.js` watches for new ChatGPT messages (tracks `[data-message-author-role]` element count). When new messages arrive while the panel is open, it sends `CONTEXT_STALE` → `background.js` → side panel port → side panel shows a refresh banner. The panel debounces refresh scheduling to avoid rapid fires.

### DOM Robustness

ChatGPT's DOM changes frequently. `dom-reader.js` handles this with:
- All selectors isolated in the `SELECTORS` object at the top of the file — **this is the single file to update when ChatGPT changes its DOM**
- Three fallback read strategies tried in order: `[data-message-author-role]` → `article[data-testid]` → `.markdown, .prose`

### Markdown Rendering

`renderMarkdown()` in `sidepanel/sidepanel.js` uses a numbered step pipeline (Steps 1–10). HTML is escaped via `escapeHtml()` before processing to prevent XSS.
- Lists are processed by `processLists()` (just above `renderMarkdown`) — handles loose lists (blank lines between items)
- The global CSS reset (`*, *::before, *::after { padding: 0 }`) strips default list padding. Always use `padding-left` (not `margin-left`) on `ul`/`ol` — bullets render in the padding area and are clipped without it

### Per-Tab Panel Visibility

The panel is enabled per-tab only for ChatGPT URLs via `setPanelEnabledForTab(tabId, url)`. On SW startup, `syncExistingTabsPanelState()` re-enables the panel for any already-open ChatGPT tabs. For the toolbar button, `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` is used — no manual `open()` call.

Open tabs are tracked via the `activePanelPorts` Map (tabId → port) in memory. There is no separate `openedTabs` set — if a port exists in `activePanelPorts`, the panel is open for that tab. A secondary `panelPortsByWindow` Map (windowId → port) is used for `TAB_ACTIVATED` routing.

**Key gotcha:** Chrome fully unloads the side panel HTML when the panel is disabled for a tab. All per-tab state must live in `chrome.storage.session` — never rely on in-memory JS surviving a tab switch.

**Key gotcha — user gesture:** `chrome.sidePanel.open()` requires an active user gesture. Any `await` before the call (e.g., `await setOptions(...)`) can silently strip that context and cause the panel to not open. For context-menu / Ask SideChat, call `open({ tabId })` with no preceding `await`. Pre-enable the panel via `tabs.onUpdated` so no async work is needed at click time. Always log `open()` failures with `console.error` — never swallow them with `.catch(() => {})`.

**Key gotcha — port disconnects:** `sidepanel` port disconnects happen during normal lifecycle transitions (tab switches, SW restarts), not only when the user explicitly closes the panel. Don't disable the panel or clear session state on disconnect alone. The panel auto-reconnects after 100ms on disconnect; on reconnect it calls `GET_PENDING_TEXT` to fetch any stashed context-menu text.

**Explicit close detection:** sidepanel port disconnect + `chrome.tabs.get(tabId)` succeeding → user closed the panel (not a tab switch). Removes the tab from `activePanelPorts` and clears session state.

**Background streaming continuation:** If the panel disconnects mid-stream (tab switch), `background.js` continues the fetch and saves the completed response to `tabState_<tabId>` in session storage. The panel loads it on reopen.

**Tab reload handling:** When `tabs.onUpdated` fires with `status: 'loading'`, background sends `NEW_CONVERSATION` with `isReload: true` to clear the panel state. When the page finishes loading (`status: 'complete'`), background delays `LOAD_CONTEXT` by 800ms to allow ChatGPT's DOM to render before reading context.

### Message Types

| Type | Direction | Purpose |
|------|-----------|---------|
| `REGISTER_TAB` | panel → bg | Panel registers its tabId on startup |
| `GET_CONTEXT` | panel → bg → content | Request main conversation from ChatGPT DOM |
| `CONTEXT_STALE` | content → bg → panel | New ChatGPT message detected; show refresh banner |
| `NEW_CONVERSATION` | content → bg → panel | ChatGPT URL/conversation changed; clear side-chat |
| `LOAD_CONTEXT` | bg → panel | Page loaded; trigger context fetch |
| `TAB_ACTIVATED` | bg → panel | User switched tabs |
| `SELECTED_TEXT` | bg → panel | Deliver context-menu selected text to panel |
| `GET_PENDING_TEXT` | panel → bg | Fetch stashed context-menu text after reconnect |
| `ASK_SIDECHAT` | content → bg | "Ask SideChat" button clicked; open panel |
| `PANEL_READY` | panel → bg → content | Panel opened; start mutation observer in content script |
| `PANEL_OPENED` | bg → content | Tell content script panel is active (start observer) |
| `PANEL_CLOSED` | bg → content | Tell content script panel closed (stop observer) |
| `PASTE_SUMMARY` | panel → bg → content | Inject summary text into ChatGPT input |
| `GET_SUMMARY` | panel → bg | Generate summary via non-streaming `callAPI()` |
| `CHAT` | panel → bg (stream port) | Send message, receive streamed response |

## Key Design Decisions

- **Per-tab ephemeral state** — side-chat state persists per-tab in `chrome.storage.session` (survives panel close/reopen within a browser session; cleared on browser close or explicit panel close)
- **No cross-session history** — intentionally avoids history, branching, or session management across browser restarts
- **ChatGPT only** — only `chatgpt.com` and `chat.openai.com` are supported (no Claude.ai, Gemini, etc.)
- **No frameworks** — pure vanilla JS; keep it that way unless there's a compelling reason
- **API keys** stored in `chrome.storage.local` (Chrome encrypts at rest); never logged

## Storage Schema

```javascript
// chrome.storage.session (per-tab ephemeral state)
{
  [`tabState_${tabId}`]: {
    context: { messages, tokenEstimate, truncated } | null,
    sideMessages: [{ role, content }],
    summaryVisible: boolean,
    pendingSelectedText: string | null,
    contextExpanded: boolean,
  }
}

// chrome.storage.local
{
  apiKeys: [{ provider: 'openai' | 'anthropic', key: string }],
  defaultModel: 'openai|gpt-4o' | 'anthropic|claude-sonnet-4-20250514' | null,
  maxContextMessages: number,  // 5-20 pairs, default 20
  summaryStyle: 'concise' | 'detailed'
}
```

## Available Models

**Anthropic:** `claude-sonnet-4-20250514` (default), `claude-opus-4-5`, `claude-haiku-4-5-20251001`

**OpenAI:** `gpt-4o` (default), `gpt-4o-mini`, `gpt-4-turbo`

## Requirements Spec

Full MVP specification is in `.spec/requirement.md` — covers user flows, error handling, UI/UX, and definition of done. Known issues and backlog are tracked in `.spec/issues.md`.
