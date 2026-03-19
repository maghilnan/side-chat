# Guide to Testing SideChat

A beginner-friendly guide to the automated tests in this project.

---

## What is automated testing?

Instead of manually opening the extension and clicking around to check if things work, we write code that does the checking for us. You run a single command and it tells you what's working and what's broken.

There are two kinds of tests here:

1. **Unit tests** — Test individual functions in isolation. Fast, no browser needed.
2. **E2E (end-to-end) tests** — Open a real Chrome browser, load the extension, and interact with it like a user would.

---

## Setup (one time)

```bash
npm install                        # Install test dependencies
npx playwright install chromium    # Download the Chrome browser for E2E tests
```

---

## How to run tests

| Command | What it does |
|---|---|
| `npm run test:unit` | Runs all unit tests. Takes about 1 second. |
| `npm run test:e2e` | Runs all E2E tests. Opens Chrome windows briefly. Takes ~10 seconds. |
| `npm run test:unit:watch` | Runs unit tests and re-runs them every time you save a file. Great while coding. |
| `npm run test:e2e:headed` | Same as test:e2e but keeps the browser visible so you can watch what's happening. |
| `npm test` | Runs both unit and E2E tests back to back. |

When tests pass you'll see green checkmarks. When they fail you'll see red Xs with an explanation of what went wrong.

---

## What each unit test file covers

All unit tests live in `tests/unit/`. They test the utility functions without needing a browser.

### api.test.js (32 tests)

Tests the API wrapper in `utils/api.js`. This is the code that talks to OpenAI and Anthropic.

What it checks:
- Request URLs are correct (openai.com vs anthropic.com)
- Auth headers are set properly (Bearer token vs x-api-key)
- System messages are handled differently for Anthropic (pulled out of the messages array)
- Streaming response parsing works for both providers (the "data: ..." lines that come back)
- Error codes (401, 429, etc.) produce the right user-facing messages
- Network failures are handled gracefully

### dom-reader.test.js (28 tests)

Tests the DOM parser in `utils/dom-reader.js`. This is the code that reads ChatGPT's conversation from the page.

What it checks:
- Messages are extracted correctly from ChatGPT's HTML structure
- All 3 fallback strategies work (the extension tries different CSS selectors in case ChatGPT changes their HTML)
- Long conversations get truncated to the last 20 pairs
- Code blocks inside messages are preserved with backtick wrapping
- Empty conversations return a proper error
- The input field finder tries multiple selectors before giving up

It uses HTML fixture files in `tests/fixtures/conversations/` — these are snapshots of what ChatGPT's HTML looks like.

### markdown.test.js (35 tests)

Tests the markdown renderer in `utils/markdown.js`. This turns markdown text (like `**bold**`) into HTML for display.

What it checks:
- Headers (`#`, `##`, `###`) render as h1/h2/h3 tags
- Bold (`**text**`) and italic (`*text*`) work
- Inline code and fenced code blocks render correctly
- Code blocks are protected — markdown inside them isn't processed
- Lists (bullet and numbered) are converted properly
- HTML in user content is escaped to prevent XSS attacks (`<script>` becomes `&lt;script&gt;`)

### summarizer.test.js (17 tests)

Tests the summary builder in `utils/summarizer.js`. This creates the prompt sent to the AI when generating a summary.

What it checks:
- The prompt includes the right system message
- Side-chat messages are formatted as "User: ... / Assistant: ..."
- Concise vs detailed style settings change the instructions
- System messages from the conversation are filtered out
- The "Side-note:" prefix instruction is included

### messaging.test.js (26 tests)

Tests that message objects passed between components have the right shape. Think of these as contract tests — they make sure background.js, sidepanel.js, and content-script.js all agree on what messages look like.

What it checks:
- Every message type (GET_CONTEXT, PASTE_TEXT, CHAT, etc.) has the expected fields
- Streaming messages (text chunks, done, error) have the right structure
- Response shapes (success/failure) match what each component expects

---

## What each E2E test file covers

All E2E tests live in `tests/e2e/`. They load the real extension in Chrome and interact with it.

### sidepanel.spec.js (6 tests)

Tests that the side panel loads and has all its basic elements.

What it checks:
- The panel page loads without errors
- Input area, settings gear, bottom bar buttons are all visible
- Messages area starts empty
- Send button starts disabled

### context-capture.spec.js (5 tests)

Tests the context preview card at the top of the panel.

What it checks:
- Context card is visible
- The toggle header starts collapsed
- Stale banner and refresh button exist

### conversation.spec.js (4 tests)

Tests the chat input and message area.

What it checks:
- Textarea accepts typed text
- Send button and messages area are present
- Shift+Enter doesn't send (creates a newline instead)

### ask-sidechat.spec.js (3 tests)

Tests the selected-text chip that appears when you use "Ask SideChat" on highlighted text.

What it checks:
- The chip is hidden by default
- Dismiss button and label elements exist

### add-summary.spec.js (4 tests)

Tests the summary generation UI.

What it checks:
- "Add Summary" button exists and starts disabled
- Summary card with textarea, paste/copy/cancel buttons all exist

### navigation.spec.js (2 tests)

Tests the clear button and initial state.

What it checks:
- Clear button exists and starts disabled
- Messages area starts empty

### settings.spec.js (8 tests)

Tests the inline settings panel.

What it checks:
- Opening and closing the settings overlay works
- API key form has provider dropdown, key input, and save button
- Provider dropdown has OpenAI and Anthropic options
- Model selector and context slider exist
- Context slider defaults to 20
- Summary style toggle buttons exist with "concise" active by default

---

## Project structure

```
tests/
├── unit/                          # Fast tests, no browser
│   ├── api.test.js
│   ├── dom-reader.test.js
│   ├── markdown.test.js
│   ├── summarizer.test.js
│   └── messaging.test.js
├── e2e/                           # Browser tests
│   ├── sidepanel.spec.js
│   ├── context-capture.spec.js
│   ├── conversation.spec.js
│   ├── ask-sidechat.spec.js
│   ├── add-summary.spec.js
│   ├── navigation.spec.js
│   └── settings.spec.js
├── fixtures/                      # Test data
│   ├── conversations/             # HTML snapshots of ChatGPT pages
│   │   ├── short-conversation.html
│   │   ├── long-conversation.html
│   │   ├── code-heavy.html
│   │   └── empty-conversation.html
│   ├── api-responses/             # Canned API responses
│   │   ├── openai-stream.txt
│   │   ├── anthropic-stream.txt
│   │   ├── openai-error-auth.json
│   │   ├── openai-error-rate-limit.json
│   │   └── summary-response.json
│   ├── mock-chatgpt.html          # Fake ChatGPT page for E2E
│   └── mock-chatgpt.js
└── helpers/
    ├── chrome-mock.js             # Fakes Chrome APIs for unit tests
    └── playwright-helpers.js      # Helpers for E2E tests
```

---

## Tools used

| Tool | Purpose |
|---|---|
| **Vitest** | Runs unit tests. Like Jest but faster. |
| **jsdom** | Simulates a browser DOM in Node.js so unit tests can test DOM-related code without opening a browser. |
| **jest-chrome** | Provides fake versions of Chrome extension APIs (chrome.storage, chrome.runtime, etc.) for unit tests. |
| **Playwright** | Opens a real Chrome browser and controls it programmatically for E2E tests. |
| **serve** | A simple HTTP server that serves the mock ChatGPT page during E2E tests. |

---

## Tips

- **Start with unit tests.** They're fast and give you instant feedback. Run `npm run test:unit:watch` while you code.
- **Read the failure message.** When a test fails, it tells you what it expected vs what it got. That's usually enough to find the bug.
- **Fixtures are your friend.** The HTML files in `tests/fixtures/conversations/` show you exactly what DOM structure the tests expect. If ChatGPT changes their HTML, update those fixtures and the SELECTORS in `dom-reader.js`.
- **E2E tests are slower.** Only run them when you've finished a change, not on every save.
