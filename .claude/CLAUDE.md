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
| `sidepanel/settings.js` | Settings UI logic for the side panel settings view |
| `utils/api.js` | OpenAI & Anthropic API wrappers with streaming support |
| `utils/dom-reader.js` | ChatGPT DOM parser with 3-tier fallback strategies |
| `utils/summarizer.js` | Builds system/user prompts for summary generation |
| `options/options.js` | Settings page — API key management and preferences |

### Streaming Architecture

The extension uses long-lived Chrome ports for streaming:

1. `sidepanel.js` calls `chrome.runtime.connect({name: 'api-stream'})` when user sends a message
2. `background.js` receives the port, makes a `fetch()` to OpenAI/Anthropic, and pipes `ReadableStream` chunks via `port.postMessage()`
3. `sidepanel.js` listens on `port.onMessage` and renders chunks as they arrive

A separate persistent port (`name: 'sidepanel'`) lets background notify the side panel of context changes.

### Context Capture Flow

1. `sidepanel.js` sends `GET_CONTEXT` → `background.js` → forwards to `content-script.js`
2. `content-script.js` calls `dom-reader.js` to extract conversation from ChatGPT DOM
3. Returns `{messages, tokenEstimate, truncated}` back up the chain
4. `sidepanel.js` renders a collapsible context preview

### Stale Context Detection

A `MutationObserver` in `content-script.js` watches for new ChatGPT messages. When new messages arrive while the panel is open, it sends `CONTEXT_STALE` → `background.js` → side panel port → side panel shows a refresh banner.

### DOM Robustness

ChatGPT's DOM changes frequently. `dom-reader.js` handles this with:
- All selectors isolated in the `SELECTORS` object at the top of the file — **this is the single file to update when ChatGPT changes its DOM**
- Three fallback read strategies tried in order: `[data-message-author-role]` → `article[data-testid]` → `.markdown, .prose`

### Markdown Rendering

`renderMarkdown()` in `sidepanel/sidepanel.js` uses a numbered step pipeline (Steps 1–10).
- Lists are processed by `processLists()` (just above `renderMarkdown`) — handles loose lists (blank lines between items)
- The global CSS reset (`*, *::before, *::after { padding: 0 }`) strips default list padding. Always use `padding-left` (not `margin-left`) on `ul`/`ol` — bullets render in the padding area and are clipped without it

### Per-Tab Panel Visibility

The panel is disabled globally on SW startup (`chrome.sidePanel.setOptions({ enabled: false })`), then enabled per-tab only when explicitly opened. `openedTabs` Set in `background.js` tracks which tabs have an active panel; mirrored to `chrome.storage.session` to survive SW restarts. `tabs.onActivated` re-opens the panel for tabs in `openedTabs`.

**Key gotcha:** Chrome fully unloads the side panel HTML when the panel is disabled for a tab. All per-tab state must live in `chrome.storage.session` — never rely on in-memory JS surviving a tab switch.

**Explicit close detection:** sidepanel port disconnect + `chrome.tabs.get(tabId)` succeeding → user closed the panel (not a tab switch). Removes the tab from `openedTabs` and clears session state.

**Background streaming continuation:** If the panel disconnects mid-stream (tab switch), `background.js` continues the fetch and saves the completed response to `tabState_<tabId>` in session storage. The panel loads it on reopen.

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
  openedTabs: [tabId, ...],  // tabs with panel explicitly opened
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

## Requirements Spec

Full MVP specification is in `.spec/requirement.md` — covers user flows, error handling, UI/UX, and definition of done.
