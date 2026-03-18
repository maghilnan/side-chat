# SideChat — Chrome Extension MVP Spec
## Ephemeral Side-Conversations for ChatGPT

---

## What This Is

A Chrome extension that lets you have **ephemeral side-conversations** while chatting on ChatGPT. The side-chat inherits context from your main conversation but doesn't pollute it. When you're done, you either add a summary back into the main chat or discard everything.

**Mental model:** It's a sticky note you scribble on mid-conversation, not a git branch you have to manage.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│ ChatGPT Tab                                         │
│ ┌─────────────────────────┐ ┌─────────────────────┐ │
│ │                         │ │                     │ │
│ │   ChatGPT Main Chat     │ │  Context preview    │ │
│ │   (unchanged)           │ │  ───────────────    │ │
│ │                         │ │  Side conversation  │ │
│ │                         │ │  ───────────────    │ │
│ │                         │ │  [Text input]       │ │
│ │                         │ │  Add Summary|Clear  │ │
│ │                         │ │  ⚙ Settings         │ │
│ └─────────────────────────┘ └─────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

**Key architecture decisions:**
- **Manifest V3** Chrome extension (required for Chrome Web Store)
- **Content Script** injected into `chatgpt.com` pages to read DOM
- **Side Panel API** (Chrome Side Panel API) for the chat UI — more stable than injecting into ChatGPT's DOM
- **No backend server** — all processing happens locally or via direct API calls from the extension
- **BYOK (Bring Your Own Key)** — user provides their own OpenAI or Anthropic API key. Stored in `chrome.storage.local` (encrypted at rest by Chrome). No key = no side-chat functionality.

---

## Core User Flow

### Opening SideChat
1. User is on `chatgpt.com` in an active conversation
2. User triggers SideChat via:
   - **Keyboard shortcut:** `Cmd+Shift+S` (Mac) / `Ctrl+Shift+S` (Windows/Linux)
   - **Extension icon click** in toolbar
   - **Right-click context menu:** "Ask SideChat" (see "Ask SideChat" section below for selection behavior)
3. Chrome Side Panel opens on the right side of the browser

### Context Capture
4. On open, the content script reads the current ChatGPT conversation from the DOM
5. The side panel displays a **collapsed context preview** at the top:
   - Shows first line of system/user message + message count (e.g., "Building a Mac app... (14 messages)")
   - Expandable to view full captured context (read-only)
   - No token count displayed — keep it clean
6. **Context preview when expanded:**
   - User messages are **right-aligned** (same styling as the side-chat messages)
   - Assistant messages are **left-aligned** (same styling as the side-chat messages)
   - **Preserve original formatting** — when extracting from the main ChatGPT conversation, maintain markdown formatting (bold, italic, code blocks, lists, headers, etc.) rather than stripping to plain text. Render this using the same markdown renderer used for side-chat messages.
   - Read-only — no editing, no interaction
7. **What gets captured:**
   - All user and assistant message pairs visible in the current conversation thread
   - Captured with formatting preserved (markdown structure, code blocks with language hints, lists, bold/italic)
   - Maximum capture: **last 20 message pairs** (40 messages). Older messages truncated with a note.
   - If conversation is empty or unreadable, show clear error: "Couldn't read the conversation. Try refreshing the page."

### "Ask SideChat" — Text Selection Flow
8. User selects text anywhere on the ChatGPT page and right-clicks → **"Ask SideChat"** context menu option
9. If the side panel is not open, it opens. If already open, it stays as-is.
10. The selected text appears as a **tag** inside the text input area:
    - Displayed as a styled chip/pill (e.g., light background, rounded corners, small "×" to remove)
    - The tag shows a truncated preview of the selected text (first ~50 characters + "..." if longer)
    - The tag sits above the text cursor inside the input area — the user can still type their own message below/after it
    - Hovering the tag shows the full selected text in a tooltip
11. **Tag behavior:**
    - Only **one tag** can be active at a time. Selecting new text and clicking "Ask SideChat" again replaces the previous tag.
    - The tag **persists across messages until explicitly cleared.** It is NOT cleared when the user sends a message.
    - The tag is cleared when:
      - User clicks the "×" on the tag
      - User selects new text and clicks "Ask SideChat" (replaced by new tag)
      - Side panel is closed
      - Chat is cleared via "Clear" button
      - Page is refreshed or a new ChatGPT conversation is opened
    - **Correction to above:** The tag **IS cleared after the user sends a message.** Once the message is sent, the tagged context has been included in that API call, and the tag should disappear from the input area. If the user wants to ask another question about the same selection, they re-select and "Ask SideChat" again.
12. **How tags are sent to the API:**
    - When a message is sent with a tag present, the tagged text is included as additional context in the API call — prepended to the user's typed message with a clear separator:
      ```
      [Referenced text from main conversation]:
      {full tagged text}

      [User's question]:
      {typed message}
      ```
    - If the user sends a message with only a tag (no typed text), it's sent as: "The user has selected the following text from their main conversation and wants to discuss it: {full tagged text}"
    - After sending, the tag is removed from the input area

### Side Conversation
13. Below the context preview, a chat interface appears:
    - Messages displayed with user messages **right-aligned** and assistant messages **left-aligned**
    - **Markdown rendering:** Assistant responses are rendered as formatted markdown (headers, bold, italic, code blocks with syntax highlighting, lists, tables, links, etc.). Use a lightweight markdown renderer (e.g., `marked` + `highlight.js` for code, or similar).
    - User messages are rendered as plain text (no markdown processing)
    - Streaming responses supported (tokens appear as they arrive, markdown rendering updates progressively)
14. **How the API call works:**
    - System prompt: `"You are continuing a conversation as a helpful assistant. The user has opened a side-chat to explore a tangent. Below is the context from their main conversation for reference. Answer their side-question, staying focused on what they ask without trying to continue the main conversation thread."`
    - The captured ChatGPT conversation is included as the initial context (formatted as a series of user/assistant messages)
    - Side-chat messages are appended after the context
    - Each subsequent message in the side-chat includes the full side-chat history (standard multi-turn)
15. **Model selection:**
    - Default: whatever model the API key supports (gpt-4o for OpenAI, claude-sonnet-4-20250514 for Anthropic)
    - Model is configured in Settings only — no dropdown in the main chat UI
    - Support both OpenAI and Anthropic API formats

### Add Summary (The Critical Interaction)
16. At any point during the side conversation, user can click **"Add Summary"** button (below the input area)
17. On click:
    - The extension generates a summary of the side conversation using the same API:
      - Prompt: `"Summarize the following side-conversation in 1-3 concise sentences. Focus on the conclusion/answer, not the back-and-forth. Format it as a note the user would paste into their main conversation to provide context. Start with 'Side-note:' prefix."`
      - Input: the side-chat messages only (not the original context)
    - The generated summary is shown to the user in a **preview card** with:
      - The summary text (editable — user can modify before adding)
      - **"Copy to Clipboard"** button — copies the summary text
      - **"Paste into ChatGPT"** button — attempts to programmatically paste into ChatGPT's input field
      - **"Cancel"** button — go back to side-chat
18. **"Paste into ChatGPT" behavior:**
    - Content script locates ChatGPT's text input field in the DOM
    - Sets the text content of the input field to the summary
    - Does **NOT** auto-send — the user must press Enter themselves in ChatGPT to actually send it
    - If the input field can't be found (DOM changed), fall back to clipboard copy with a toast: "Couldn't paste automatically. Summary copied to clipboard — paste it manually."
19. After adding (or copying), the side panel stays open so the user can continue if needed

### Clear
20. The **"Clear"** button (below the input area, next to "Add Summary"):
    - Clears all side-chat messages
    - Clears any tagged selection in the input area
    - Does NOT close the side panel
    - Does NOT re-read the main conversation context (the context preview stays as-is)
    - Effectively starts a fresh side-chat within the same panel session

### Auto-Clear on Navigation / Refresh
21. The side panel content **automatically clears** when:
    - The user navigates to a **new ChatGPT conversation** (URL change detected)
    - The user **refreshes the page**
    - A new chat is started in ChatGPT
22. On auto-clear:
    - All side-chat messages are discarded
    - Any tagged selection is removed
    - The context preview is cleared
    - The side panel re-reads the new conversation's context (if any)
    - No confirmation dialog — this is automatic and expected

### Discard / Close
23. When user closes the side panel (keyboard shortcut or clicking away):
    - All side-chat messages are **immediately discarded** — no persistence, no history, no local storage of conversations
    - The captured context is also discarded
    - Next time the panel opens, it starts fresh (re-reads current ChatGPT conversation)
24. No confirmation dialog on close — ephemerality is the point. Keep it frictionless.

---

## Settings / Configuration

Accessed via a **gear icon at the bottom of the side panel** (below the action buttons).

Clicking the gear icon opens settings **inline within the side panel** (slides up or replaces the chat view) — not a separate browser tab.

### Required Settings
- **API Key(s):** One or more API keys (OpenAI and/or Anthropic)
  - Stored in `chrome.storage.local`
  - Shown as masked (••••••••sk-1234) after entry
  - "Test" button to verify key works
  - Clear instructions: "Your key is stored locally in your browser. It is never sent to any server other than the AI provider's API."

### Optional Settings
- **Default model:** Dropdown of available models based on configured keys
- **Max context messages:** Slider, 5-20 message pairs (default: 20)
- **Auto-summary style:** Toggle between "Concise (1-2 sentences)" and "Detailed (2-4 sentences)"

---

## Technical Implementation Details

### Manifest V3 Structure
```
sidechat/
├── manifest.json
├── background.js          # Service worker — handles API calls
├── content-script.js      # Injected into chatgpt.com — reads DOM, handles text selection
├── sidepanel/
│   ├── sidepanel.html     # Side panel UI
│   ├── sidepanel.js       # Side panel logic
│   ├── sidepanel.css      # Styles
│   └── settings.js        # Inline settings panel logic
├── icons/
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
└── utils/
    ├── api.js             # OpenAI + Anthropic API wrappers
    ├── dom-reader.js      # ChatGPT DOM parsing logic (isolated for easy updates)
    ├── markdown.js         # Markdown rendering setup (marked + highlight.js)
    └── summarizer.js      # Summary generation logic
```

### Permissions Required
```json
{
  "permissions": [
    "sidePanel",
    "storage",
    "activeTab",
    "contextMenus"
  ],
  "host_permissions": [
    "https://chatgpt.com/*",
    "https://chat.openai.com/*",
    "https://api.openai.com/*",
    "https://api.anthropic.com/*"
  ],
  "content_scripts": [{
    "matches": ["https://chatgpt.com/*", "https://chat.openai.com/*"],
    "js": ["content-script.js"]
  }]
}
```

### DOM Reading Strategy
- ChatGPT renders conversations in `article` elements or divs with `data-message-*` attributes
- **Important:** ChatGPT's DOM structure changes frequently. Isolate ALL DOM selectors into a single `dom-reader.js` file with clearly labeled selectors at the top, so when ChatGPT updates their frontend, only one file needs updating.
- Strategy:
  1. First try: Look for `[data-message-author-role]` attributes (current known structure)
  2. Fallback: Look for alternating message containers with role indicators
  3. Last resort: Use `document.querySelectorAll` with broader selectors and infer roles from position (odd/even)
- **Extract with formatting preserved:** Capture the inner HTML of message containers and convert to markdown (preserve code blocks, lists, bold/italic, headers). Use a DOM-to-markdown approach rather than stripping to plain text.
- Fire a `MutationObserver` on the conversation container to detect if new messages are added while side panel is open (don't auto-update — just show a subtle "Main conversation has new messages. Click to refresh context." banner)
- **URL change detection:** Listen for `popstate` events and/or poll `window.location.href` to detect navigation to a new conversation. On URL change, send a message to the side panel to trigger auto-clear and context re-read.

### Context Menu ("Ask SideChat")
- Register context menu item in `background.js` using `chrome.contextMenus.create` with `contexts: ["selection"]`
- On click: capture `selectionText` from the context menu event, send it to the side panel via `chrome.runtime.sendMessage`
- Side panel receives the selected text and displays it as a tag in the input area
- If side panel is not open, open it first (via `chrome.sidePanel.open`), then send the selection

### API Call Handling
- All API calls made from **background.js** (service worker) to avoid CORS issues
- Side panel sends messages to background via `chrome.runtime.sendMessage`
- Background makes fetch calls to OpenAI/Anthropic endpoints
- Streaming: Use `ReadableStream` for streaming responses back to side panel
- **Tagged text in API calls:** When a message includes a tagged selection, format it as described in the "Ask SideChat" section (referenced text + user question, clearly separated)
- Error handling:
  - Invalid API key → "API key is invalid. Check your settings."
  - Rate limited → "Rate limited. Wait a moment and try again."
  - Network error → "Couldn't reach the API. Check your connection."
  - Token limit exceeded → "Conversation too long. Try starting a new side-chat."

### Markdown Rendering
- Use `marked` library (lightweight, fast) for markdown-to-HTML conversion
- Use `highlight.js` (or `prism.js`) for syntax highlighting in code blocks
- Sanitize rendered HTML to prevent XSS (use `DOMPurify` or equivalent)
- Apply markdown rendering to:
  - Assistant messages in the side-chat
  - Context preview messages (both user and assistant) when expanded
- Do NOT apply markdown rendering to user-typed messages in the side-chat (show as plain text)
- Streaming: Re-render markdown on each chunk arrival. Buffer partial code blocks to avoid rendering half-formed markdown.

---

## UI/UX Design Guidelines

### Side Panel Appearance
- **Width:** Uses Chrome's default side panel width (~400px, user-resizable by Chrome)
- **Theme:** Match system dark/light mode via `prefers-color-scheme`
- **Clean, minimal UI** — this is a utility tool, not a design showcase
  - Monospace font for code snippets in messages
  - Sans-serif system font stack for everything else (no custom fonts needed)
  - High-contrast text on background
  - Subtle borders, no heavy shadows

### Layout (top to bottom)
1. **Context preview:** Collapsible card showing captured conversation summary. Default: collapsed. Light background tint to visually separate from side-chat messages. When expanded, shows messages with preserved formatting (user right-aligned, assistant left-aligned).
2. **Messages area:** Scrollable, auto-scrolls to bottom on new messages. User messages right-aligned with accent color background. Assistant messages left-aligned with neutral background. Markdown rendered for assistant messages.
3. **Input area:** Multi-line text input with send button **inside the text box** (see below). Pinned to bottom.
4. **Action bar:** Below the input area — "Add Summary" button (primary style) + "Clear" button (ghost/text style)
5. **Settings:** Gear icon at the bottom, below the action bar. Opens inline settings panel.

**No header bar.** No "SideChat" label, no X button at the top. The side panel uses Chrome's built-in close mechanism (user clicks away or uses keyboard shortcut). This keeps the UI maximally clean and gives more vertical space to the conversation.

### Input Area Design
- **Text input** is a multi-line textarea with auto-expanding height (grows with content, up to a max height, then scrolls)
- **Send button** is positioned **inside** the text input area:
  - For single-line input: send button appears at the right edge of the input, vertically centered
  - For multi-line input: send button drops to the **bottom-right corner** of the text input area (inside the border, on the last line)
  - Send button is a small icon (arrow/send icon), not a full text button
- **Enter** to send, **Shift+Enter** for newline
- **Tagged selection display:**
  - When a text selection is tagged (via "Ask SideChat"), it appears as a **chip/pill** inside the input area, above the text cursor
  - Chip styling: slightly tinted background, rounded corners, small "×" button on the right to dismiss
  - Chip shows truncated text (~50 chars) with tooltip for full text on hover
  - The chip is visually distinct from typed text — it looks like a tag/label, not a pasted quote
  - User types their question below/after the chip in the same input area

### Loading States
- While reading DOM: spinner + "Reading conversation..."
- While waiting for API response: pulsing dots in assistant message area
- While generating summary: "Generating summary..." in the preview card

### Empty / Error States
- No API key configured: Full-panel message — "Add your API key in settings to get started" with button to open settings
- Can't read conversation: "Couldn't read the ChatGPT conversation. Make sure you're on an active chat page and try refreshing."
- No conversation on page: "Start a conversation in ChatGPT first, then open SideChat."

---

## What This MVP Does NOT Include (Intentional Cuts)

- ❌ No conversation persistence / history — ephemeral by design
- ❌ No support for Claude.ai, Gemini, or other chat interfaces (ChatGPT only for v1)
- ❌ No image or file attachment handling — text only
- ❌ No tree visualization of branches — this is a side panel, not a graph
- ❌ No auto-branch detection — user manually triggers side-chat
- ❌ No team features or sharing
- ❌ No analytics or usage tracking
- ❌ No Chrome Web Store publishing setup (local dev/sideload only for v1)
- ❌ No automated tests (manual testing for v1, add tests in Phase 2)
- ❌ No model selector in the main chat UI (configure in settings only)
- ❌ No token count display

---

## Definition of Done (for MVP)

The extension is complete when:
1. ✅ User can install extension locally via `chrome://extensions` developer mode
2. ✅ Side panel opens via keyboard shortcut aI want to do like automated testing unit testing and also UI driven testing by clicking around and performing some actions how do I do this for this particular extensionnd extension icon on `chatgpt.com`
3. ✅ Current ChatGPT conversation is captured and displayed in collapsed context preview with preserved formatting (user right, assistant left, markdown rendered)
4. ✅ User can have a multi-turn conversation in the side panel using their API key
5. ✅ Streaming responses work for both OpenAI and Anthropic APIs
6. ✅ Assistant responses render markdown correctly (headers, bold, code blocks, lists, etc.)
7. ✅ "Ask SideChat" context menu works: selected text appears as a tag in the input area, is sent as context with the next message, and clears after sending
8. ✅ "Add Summary" generates an editable summary and can paste it into ChatGPT's input field (or copy to clipboard as fallback)
9. ✅ "Clear" button resets side-chat messages and tagged selections
10. ✅ Side panel auto-clears on page refresh or navigation to a new ChatGPT conversation
11. ✅ Closing the panel discards all side-chat data
12. ✅ Settings accessible via gear icon at bottom of panel, opens inline
13. ✅ Settings page allows adding/removing/testing API keys and selecting default model
14. ✅ Reasonable error handling for all failure modes (no API key, bad key, network errors, unreadable DOM)
15. ✅ Works in both light and dark mode