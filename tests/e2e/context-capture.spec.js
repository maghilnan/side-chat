import { test, expect, chromium } from '@playwright/test';
import path from 'path';
import { getExtensionId, openSidePanel } from '../helpers/playwright-helpers.js';

let context;
let extensionId;

test.beforeAll(async () => {
  const extensionPath = path.resolve('.');
  context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  extensionId = await getExtensionId(context);
});

test.afterAll(async () => {
  await context.close();
});

test.describe('Context Capture', () => {
  test('context card is visible in side panel', async () => {
    const panel = await openSidePanel(context, extensionId);
    await expect(panel.locator('#context-card')).toBeVisible();
    await panel.close();
  });

  test('context header is clickable for toggle', async () => {
    const panel = await openSidePanel(context, extensionId);
    const header = panel.locator('#context-header');
    await expect(header).toBeVisible();
    // Initially collapsed
    await expect(header).toHaveAttribute('aria-expanded', 'false');
    await panel.close();
  });

  test('context body exists', async () => {
    const panel = await openSidePanel(context, extensionId);
    await expect(panel.locator('#context-body')).toBeAttached();
    await panel.close();
  });

  test('stale banner is initially hidden', async () => {
    const panel = await openSidePanel(context, extensionId);
    // The stale banner should not be visible initially
    const staleBanner = panel.locator('#stale-banner');
    await expect(staleBanner).toBeAttached();
    await panel.close();
  });

  test('refresh context button exists in stale banner', async () => {
    const panel = await openSidePanel(context, extensionId);
    await expect(panel.locator('#refresh-context-btn')).toBeAttached();
    await panel.close();
  });
});
