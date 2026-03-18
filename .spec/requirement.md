# SideChat — Chrome Extension MVP Spec

## Ephemeral Side-Conversations for ChatGPT

---

## What This Is

A Chrome extension that lets you have **ephemeral side-conversations** while chatting on ChatGPT. The side-chat inherits context from your main conversation but doesn't pollute it. When you're done, you either inject a summary back into the main chat or discard everything.

**Mental model:** It's a sticky note you scribble on mid-conversation, not a git branch you have to manage.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│ ChatGPT Tab                                         │
│ ┌─────────────────────────┐ ┌─────────────────────┐ │
│ │                         │ │   SideChat Panel     │ │
│ │   ChatGPT Main Chat     │ │                     │ │
│ │   (unchanged)           │ │  Context preview    │ │
│ │                         │ │  ───────────────    │ │
│ │                         │ │  Side conversation  │ │
│ │                         │ │  ───────────────    │ │
│ │                         │ │  [Inject] [Discard] │ │
│ │                         │ │  Text input + Send  │ │
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
   - **Extension icon click** in toolbar
   - **Right-click context menu:** "Open SideChat"
3. Chrome Side Panel opens on the right side of the browser

### Context Capture

4. On open, the content script reads the current ChatGPT conversation from the DOM
5. The side panel displays a **collapsed context preview** at the top:
   - Shows first line of system/user message + message count (e.g., "Building a Mac app... (14 messages)")
   - Expandable to view full captured context (read-only)
   - A small token count estimate displayed (e.g., "~8.2K tokens")
6. **What gets captured:**
   - All user and assistant message pairs visible in the current conversation thread
   - Captured as plain text (no images, no file attachments, no code execution outputs)
   - Maximum capture: **last 20 message pairs** (40 messages). Older messages truncated with a note.
   - If conversation is empty or unreadable, show clear error: "Start a conversation or try refreshing the page."

### Side Conversation

7. Below the context preview, a chat interface appears:
   - Text input field with send button (Enter to send, Shift+Enter for newline)
   - Messages displayed in standard chat bubble format (user on right, assistant on left)
   - Streaming responses supported (tokens appear as they arrive)
8. **How the API call works:**
   - System prompt: `"You are continuing a conversation as a helpful assistant. The user has opened a side-chat to explore a tangent. Below is the context from their main conversation for reference. Answer their side-question, staying focused on what they ask without trying to continue the main conversation thread."`
   - The captured ChatGPT conversation is included as the initial context (formatted as a series of user/assistant messages)
   - Side-chat messages are appended after the context
   - Each subsequent message in the side-chat includes the full side-chat history (standard multi-turn)
9. **Model selection:**
   - Default: whatever model the API key supports (gpt-4o for OpenAI, claude-sonnet-4-20250514 for Anthropic)
   - Simple dropdown to switch between configured API keys/models
   - Support both OpenAI and Anthropic API formats

### Inject Summary (The Critical Interaction)

10. At any point during the side conversation, user can click **"Inject Summary"** button
11. On click:
    - The extension generates a summary of the side conversation using the same API:
      - Prompt: `"Summarize the following side-conversation in 1-3 concise sentences. Focus on the conclusion/answer, not the back-and-forth. Format it as a note the user would paste into their main conversation to provide context. Start with 'Side-note:' prefix."`
      - Input: the side-chat messages only (not the original context)
    - The generated summary is shown to the user in a **preview card** with:
      - The summary text (editable — user can modify before injecting)
      - **"Copy to Clipboard"** button — copies the summary text
      - **"Paste into ChatGPT"** button — attempts to programmatically paste into ChatGPT's input field
      - **"Cancel"** button — go back to side-chat
12. **"Paste into ChatGPT" behavior:**
    - Content script locates ChatGPT's text input field in the DOM
    - Sets the text content of the input field to the summary
    - Does **NOT** auto-send — the user must press Enter themselves in ChatGPT to actually send it
    - If the input field can't be found (DOM changed), fall back to clipboard copy with a toast: "Couldn't paste automatically. Summary copied to clipboard — paste it manually."
13. After injecting (or copying), the side panel stays open so the user can continue if needed

### Discard / Close

14. When user closes the side panel (X button, keyboard shortcut, or clicking away):
    - All side-chat messages are **immediately discarded** — no persistence, no history, no local storage of conversations
    - The captured context is also discarded
    - Next time the panel opens, it starts fresh (re-reads current ChatGPT conversation)
15. No confirmation dialog on close — ephemerality is the point. Keep it frictionless.

---

## Settings / Configuration

Accessed via a small gear icon in the side panel header.

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
├── content-script.js      # Injected into chatgpt.com — reads DOM
├── sidepanel/
│   ├── sidepanel.html     # Side panel UI
│   ├── sidepanel.js       # Side panel logic
│   └── sidepanel.css      # Styles
├── options/
│   ├── options.html       # Settings page (API keys)
│   └── options.js
├── icons/
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
└── utils/
    ├── api.js             # OpenAI + Anthropic API wrappers
    ├── dom-reader.js      # ChatGPT DOM parsing logic (isolated for easy updates)
    └── summarizer.js      # Summary generation logic
```

### Permissions Required

```json
{
  "permissions": [
    "sidePanel",
    "storage",
    "activeTab"
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
- Extract text content only — strip HTML formatting, code blocks become plain text with triple-backtick wrapping
- Fire a `MutationObserver` on the conversation container to detect if new messages are added while side panel is open (don't auto-update — just show a subtle "Main conversation has new messages. Click to refresh context." banner)

### API Call Handling

- All API calls made from **background.js** (service worker) to avoid CORS issues
- Side panel sends messages to background via `chrome.runtime.sendMessage`
- Background makes fetch calls to OpenAI/Anthropic endpoints
- Streaming: Use `ReadableStream` for streaming responses back to side panel
- Error handling:
  - Invalid API key → "API key is invalid. Check your settings."
  - Rate limited → "Rate limited. Wait a moment and try again."
  - Network error → "Couldn't reach the API. Check your connection."
  - Token limit exceeded → "Conversation too long. Try starting a new side-chat."

### Token Estimation

- Simple approximation: 1 token ≈ 4 characters (English)
- Display estimated token count of captured context in the context preview
- Warn if context + side-chat approaches model limit (e.g., >100K tokens for GPT-4o)

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

1. **Header bar:** "SideChat" label + gear icon (settings) + X (close)
2. **Context preview:** Collapsible card showing captured conversation summary. Default: collapsed. Light background tint to visually separate from side-chat messages.
3. **Messages area:** Scrollable, auto-scrolls to bottom on new messages. User messages right-aligned with accent color background. Assistant messages left-aligned with neutral background.
4. **Action bar:** "Inject Summary" button (primary style) + "Clear Chat" button (ghost/text style)
5. **Input area:** Multi-line text input, send button. Pinned to bottom.

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

---

## Definition of Done (for MVP)

The extension is complete when:

1. ✅ User can install extension locally via `chrome://extensions` developer mode
2. ✅ Side panel opens via keyboard shortcut and extension icon on `chatgpt.com`
3. ✅ Current ChatGPT conversation is captured and displayed in collapsed context preview
4. ✅ User can have a multi-turn conversation in the side panel using their API key
5. ✅ Streaming responses work for both OpenAI and Anthropic APIs
6. ✅ "Inject Summary" generates an editable summary and can paste it into ChatGPT's input field (or copy to clipboard as fallback)
7. ✅ Closing the panel discards all side-chat data
8. ✅ Settings page allows adding/removing/testing API keys
9. ✅ Reasonable error handling for all failure modes (no API key, bad key, network errors, unreadable DOM)
10. ✅ Works in both light and dark mode