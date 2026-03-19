Here's a summary of everything implemented:

  What was done

  Source modifications (3 files)

  - utils/markdown.js (new) — Extracted escapeHtml, processLists, renderMarkdown from sidepanel.js with dual export (Node + browser). Fixed a latent bug where
  underscore-based italic matching corrupted code block placeholders.
  - sidepanel/sidepanel.js — Replaced inline markdown functions with destructured import from window.SidechatMarkdown
  - sidepanel/sidepanel.html — Added <script src="../utils/markdown.js"> before settings.js
  - utils/dom-reader.js — Added module.exports guard for Node/Vitest testability

  Infrastructure (4 files)

  - package.json — devDependencies (vitest, jsdom, jest-chrome, playwright, serve) + test scripts
  - vitest.config.js — jsdom environment, chrome-mock setup
  - playwright.config.js — Headed Chrome with extension loaded, serve fixtures on port 3456
  - .gitignore — node_modules/

  Test helpers (2 files)

  - tests/helpers/chrome-mock.js — jest-chrome global setup
  - tests/helpers/playwright-helpers.js — getExtensionId, openSidePanel, mockAPIRoute helpers

  Test fixtures (10 files)

  - 4 conversation DOM snapshots (short, long/25 pairs, code-heavy, empty)
  - 5 API response fixtures (OpenAI/Anthropic streams, error responses, summary)
  - Mock ChatGPT page (HTML + JS)

  Unit tests (5 files, 138 tests)

  - api.test.js — 32 tests covering request building, SSE parsing, streaming, error handling
  - dom-reader.test.js — 28 tests covering all 3 strategies, truncation, code extraction, input finding
  - markdown.test.js — 35 tests covering escaping, lists, headers, code blocks, XSS safety
  - summarizer.test.js — 17 tests covering summary messages, system prompt, style variations
  - messaging.test.js — 26 tests validating all message schemas across components

  E2E tests (7 files, 32 tests)

  - sidepanel.spec.js, context-capture.spec.js, conversation.spec.js, ask-sidechat.spec.js, add-summary.spec.js, navigation.spec.js, settings.spec.js