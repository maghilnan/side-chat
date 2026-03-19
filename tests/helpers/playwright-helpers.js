/**
 * playwright-helpers.js — Helpers for E2E testing Chrome extensions with Playwright
 */

/**
 * Get the extension ID from a Chromium browser context that has loaded an extension.
 * @param {import('@playwright/test').BrowserContext} context
 * @returns {Promise<string>} extension ID
 */
export async function getExtensionId(context) {
  // Open a service worker page to discover the extension ID
  let [background] = context.serviceWorkers();
  if (!background) {
    background = await context.waitForEvent('serviceworker');
  }
  const extensionId = background.url().split('/')[2];
  return extensionId;
}

/**
 * Open the side panel page directly in a new tab (for testing purposes).
 * In real usage the side panel is opened via chrome.sidePanel, but in Playwright
 * we navigate to it directly.
 * @param {import('@playwright/test').BrowserContext} context
 * @param {string} extensionId
 * @returns {Promise<import('@playwright/test').Page>}
 */
export async function openSidePanel(context, extensionId) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel/sidepanel.html`);
  return page;
}

/**
 * Set up API route interception on a page.
 * @param {import('@playwright/test').Page} page
 * @param {object} options
 * @param {string} options.provider - 'openai' or 'anthropic'
 * @param {string} options.body - Response body text
 * @param {number} [options.status=200] - HTTP status
 * @param {object} [options.headers] - Extra response headers
 */
export async function mockAPIRoute(page, { provider, body, status = 200, headers = {} }) {
  const urlPattern = provider === 'anthropic'
    ? '**/api.anthropic.com/**'
    : '**/api.openai.com/**';

  await page.route(urlPattern, (route) => {
    route.fulfill({
      status,
      contentType: 'application/json',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  });
}

/**
 * Mock a streaming API response (SSE).
 * @param {import('@playwright/test').Page} page
 * @param {object} options
 * @param {string} options.provider
 * @param {string[]} options.chunks - Array of SSE lines to send
 * @param {number} [options.status=200]
 */
export async function mockStreamingAPIRoute(page, { provider, chunks, status = 200 }) {
  const urlPattern = provider === 'anthropic'
    ? '**/api.anthropic.com/**'
    : '**/api.openai.com/**';

  await page.route(urlPattern, (route) => {
    const body = chunks.join('\n') + '\n';
    route.fulfill({
      status,
      contentType: 'text/event-stream',
      body,
    });
  });
}
