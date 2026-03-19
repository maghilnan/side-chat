# Task: Set Up Comprehensive Testing for SideChat Chrome Extension

## Context
SideChat is a Chrome extension (Manifest V3) that adds ephemeral side-conversations to ChatGPT. The full build spec is in `requirement-mar18.md` in this project. Read it first before writing any tests — the spec defines every feature, interaction, and edge case you need to cover.

## What I Need
Set up a complete testing infrastructure within the existing SideChat project, then write thorough tests for every feature described in the spec. Tests should live alongside the source code, not in a separate project.

## Test Stack
- **Unit tests:** Vitest + jest-chrome (for mocking Chrome extension APIs)
- **E2E tests:** Playwright with the extension loaded in headed Chrome
- **Mock page:** A local HTML file that replicates ChatGPT's DOM structure for deterministic E2E testing

## Project Structure for Tests
```
sidechat/
├── src/                          # Existing extension source
├── tests/
│   ├── unit/                     # Vitest unit tests
│   │   ├── api.test.js           # API wrapper tests (OpenAI + Anthropic formatting)
│   │   ├── dom-reader.test.js    # DOM parsing and message extraction
│   │   ├── markdown.test.js      # Markdown rendering and sanitization
│   │   ├── summarizer.test.js    # Summary prompt generation
│   │   └── messaging.test.js     # Chrome runtime message formatting
│   ├── e2e/                      # Playwright E2E tests
│   │   ├── sidepanel.spec.js     # Side panel open/close/clear lifecycle
│   │   ├── context-capture.spec.js   # Reading ChatGPT conversation from DOM
│   │   ├── conversation.spec.js  # Multi-turn side-chat conversation flow
│   │   ├── ask-sidechat.spec.js  # Text selection → tag → send → clear flow
│   │   ├── add-summary.spec.js   # Summary generation → preview → paste/copy
│   │   ├── navigation.spec.js    # Auto-clear on page refresh / URL change
│   │   └── settings.spec.js      # API key management, model selection
│   ├── fixtures/
│   │   ├── mock-chatgpt.html     # Fake ChatGPT page with realistic DOM structure
│   │   ├── mock-chatgpt.js       # JS to make the mock page interactive (input field, message containers)
│   │   ├── api-responses/        # Canned JSON responses for API mocking
│   │   │   ├── openai-stream.json
│   │   │   ├── anthropic-stream.json
│   │   │   ├── openai-error-auth.json
│   │   │   ├── openai-error-rate-limit.json
│   │   │   └── summary-response.json
│   │   └── conversations/        # Sample ChatGPT conversation DOM snapshots
│   │       ├── short-conversation.html    # 3 message pairs
│   │       ├── long-conversation.html     # 25+ message pairs (tests truncation)
│   │       ├── code-heavy.html            # Conversation with code blocks
│   │       └── empty-conversation.html    # No messages yet
│   └── helpers/
│       ├── chrome-mock.js        # jest-chrome setup and common Chrome API mocks
│       └── playwright-helpers.js # Extension loading, side panel access helpers
├── vitest.config.js
├── playwright.config.js
└── package.json                  # Add test scripts and devDependencies
```

## Configuration Files Needed

### package.json — Add these devDependencies and scripts:
```json
{
  "devDependencies": {
    "vitest": "latest",
    "jest-chrome": "latest",
    "@playwright/test": "latest",
    "jsdom": "latest"
  },
  "scripts": {
    "test": "npm run test:unit && npm run test:e2e",
    "test:unit": "vitest run",
    "test:e2e": "npx playwright test",
    "test:unit:watch": "vitest watch",
    "test:e2e:headed": "npx playwright test --headed"
  }
}
```

### vitest.config.js:
- Environment: jsdom (for DOM parsing tests)
- Setup file: `tests/helpers/chrome-mock.js` to globally mock Chrome APIs
- Include: `tests/unit/**/*.test.js`

### playwright.config.js:
- NOT headless — extensions require headed mode: `headless: false`
- Launch Chrome with extension loaded:
  ```
  args: [
    '--disable-extensions-except=./src',
    '--load-extension=./src'
  ]
  ```
- Test directory: `tests/e2e/`
- Web server: serve the mock ChatGPT page on localhost during tests
- Timeout: generous (10s+) because extension loading adds latency

## Unit Tests to Write

### api.test.js — API Wrapper Tests
- Formats messages correctly for OpenAI chat completions endpoint (correct JSON structure, model, headers)
- Formats messages correctly for Anthropic messages endpoint (correct JSON structure, model, headers, anthropic-version header)
- Includes system prompt as first message
- Includes captured context messages in correct user/assistant alternation
- Handles tagged text: when a message includes a tagged selection, it is formatted as `[Referenced text from main conversation]: {tagged text}\n\n[User's question]: {typed message}`
- Handles tag-only messages (no typed text): formats as "The user has selected the following text..."
- Correctly appends side-chat history to context for multi-turn
- Respects max context messages setting (truncates oldest when over limit)
- Returns appropriate error types for: invalid API key (401), rate limit (429), network failure, token limit exceeded

### dom-reader.test.js — DOM Parsing Tests
- Extracts user and assistant messages from ChatGPT's DOM structure (mock HTML with `data-message-author-role` attributes)
- Preserves markdown formatting: bold, italic, code blocks (with language hints), lists, headers, links
- Correctly identifies message roles (user vs assistant)
- Handles the 20 message pair limit — captures the LAST 20 pairs when conversation is longer
- Returns empty array with error flag when DOM structure is unrecognizable
- Handles edge cases: empty conversation, single message, system messages
- Falls back through selector strategies (primary → fallback → last resort)
- Extracts code blocks with triple-backtick wrapping and language annotation

### markdown.test.js — Markdown Rendering Tests
- Renders headers (h1-h6) correctly
- Renders bold, italic, strikethrough
- Renders inline code and fenced code blocks
- Renders code blocks with syntax highlighting (test that language class is applied)
- Renders ordered and unordered lists, nested lists
- Renders tables
- Renders links (and ensures they open in new tab)
- Sanitizes HTML to prevent XSS — test that `<script>`, `<iframe>`, `onerror` attributes are stripped
- Handles partial markdown during streaming (incomplete code blocks don't break rendering)

### summarizer.test.js — Summary Generation Tests
- Constructs correct prompt for summary generation (includes only side-chat messages, not original context)
- Prompt includes "Side-note:" prefix instruction
- Handles concise vs detailed summary style setting
- Returns raw text response suitable for editing

### messaging.test.js — Chrome Runtime Messaging Tests
- Content script → background: `captureConversation` message format
- Content script → side panel: `selectedText` message format  
- Side panel → background: `sendMessage` format with full conversation history
- Background → side panel: streaming chunk relay format
- Side panel → content script: `pasteToInput` message with summary text
- Error propagation: API errors in background are correctly relayed to side panel

## E2E Tests to Write

### Important: Mock ChatGPT Page
All E2E tests run against `tests/fixtures/mock-chatgpt.html`, NOT against the real chatgpt.com. The mock page must:
- Replicate ChatGPT's DOM structure: conversation container with `article` elements or divs with `data-message-author-role="user"` and `data-message-author-role="assistant"` attributes
- Include a text input field that mimics ChatGPT's prompt input (contenteditable div or textarea)
- Include sample conversation messages with varied formatting (plain text, code blocks, lists, bold)
- Support URL changes (simulate navigating to a "new conversation" by changing URL hash and swapping message content)
- Be served on localhost during tests

### Important: API Mocking in E2E
Use Playwright's `page.route()` to intercept all fetch calls to `api.openai.com` and `api.anthropic.com`. Return canned responses from `tests/fixtures/api-responses/`. For streaming tests, return chunked responses that simulate SSE streaming.

### sidepanel.spec.js — Side Panel Lifecycle
- Side panel opens when extension icon is clicked
- Side panel opens when keyboard shortcut `Ctrl+Shift+.` is pressed
- Side panel closes when user clicks away or uses shortcut again
- All side-chat content is discarded on close (reopen shows empty state)
- No header bar is rendered (no "SideChat" label, no X button)
- Settings gear icon is visible at the bottom of the panel
- Panel respects dark/light mode

### context-capture.spec.js — Context Capture
- On open, captures visible ChatGPT conversation messages from mock page
- Context preview is collapsed by default, shows message count
- Expanding context preview shows messages: user right-aligned, assistant left-aligned
- Markdown formatting is preserved in context preview
- Long conversations (25+ message pairs) are truncated to last 20 pairs
- Empty conversation shows appropriate error message
- "New messages" banner appears when mock page adds messages while panel is open

### conversation.spec.js — Side Conversation
- User can type a message and send it (Enter key)
- Shift+Enter creates a new line without sending
- Send button appears inside the text input (right edge for single line, bottom-right for multi-line)
- API is called with correct format (context + user message)
- Streaming response renders progressively in assistant message bubble
- Assistant messages render markdown (code blocks, bold, lists)
- User messages render as plain text (no markdown processing)
- Multi-turn: second message includes full side-chat history
- Error states display correctly: invalid API key, rate limit, network error

### ask-sidechat.spec.js — Text Selection Tag Flow
- Selecting text on mock page and triggering "Ask SideChat" context menu opens side panel with tag
- Tag appears as a chip/pill in the input area with truncated text
- Tag shows full text on hover (tooltip)
- Tag has "×" button to dismiss
- User can type a question below the tag and send — both tag and typed text are sent to API
- After sending, the tag is cleared from the input area
- Tag-only send (no typed text) works correctly
- New "Ask SideChat" replaces the previous tag
- Tag is cleared on "Clear" button click
- Tag is cleared on page navigation

### add-summary.spec.js — Add Summary Flow
- "Add Summary" button is visible below the input area
- Clicking it generates a summary (API call with correct prompt)
- Summary preview card appears with editable text
- User can modify summary text
- "Copy to Clipboard" copies the summary
- "Paste into ChatGPT" sets the mock page's input field to the summary text
- Summary is NOT auto-sent — input field has text but no submit triggered
- Fallback: if input field can't be found, falls back to clipboard with toast message
- "Cancel" dismisses the preview card and returns to side-chat
- Side panel stays open after pasting

### navigation.spec.js — Auto-Clear on Navigation
- Side panel clears when mock page simulates URL change (new conversation)
- Side panel clears when page is refreshed
- On clear: messages gone, tag gone, context preview gone
- Context is re-read from the new page content after clear
- "Clear" button clears messages and tags but does NOT clear the context preview

### settings.spec.js — Settings Panel
- Gear icon opens inline settings (not a new tab)
- User can enter an API key and it's stored (masked after entry)
- "Test" button verifies key works (mock API returns 200 for valid, 401 for invalid)
- User can remove a stored API key
- Model selection dropdown shows options based on configured keys
- Settings persist across panel close/reopen (stored in chrome.storage.local)
- No API key configured shows "Add your API key" message with settings button

## How to Run
After setup, I should be able to run:
- `npm run test:unit` — runs all unit tests (fast, no browser, < 10 seconds)
- `npm run test:e2e` — runs all E2E tests (headed Chrome, ~1-2 minutes)
- `npm run test:unit:watch` — runs unit tests in watch mode during development
- `npm run test:e2e:headed` — runs E2E with browser visible for debugging

## Important Notes
- Unit tests must be fast (< 10 seconds total). Mock everything external.
- E2E tests must be deterministic. Never hit real APIs or real ChatGPT. Mock everything.
- The mock ChatGPT page is critical — spend time making its DOM structure realistic. Inspect the real chatgpt.com DOM and replicate the relevant selectors.
- All tests should pass on a fresh clone after `npm install`. No manual setup steps.
- For the mock ChatGPT page DOM structure, inspect the real chatgpt.com before building fixtures to get the latest selectors — don't guess.