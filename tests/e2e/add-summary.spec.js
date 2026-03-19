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

test.describe('Add Summary', () => {
  test('inject summary button exists', async () => {
    const panel = await openSidePanel(context, extensionId);
    const injectBtn = panel.locator('#inject-btn');
    await expect(injectBtn).toBeVisible();
    await expect(injectBtn).toHaveText('Add Summary');
    await panel.close();
  });

  test('inject button is initially disabled', async () => {
    const panel = await openSidePanel(context, extensionId);
    await expect(panel.locator('#inject-btn')).toBeDisabled();
    await panel.close();
  });

  test('summary card exists with preview elements', async () => {
    const panel = await openSidePanel(context, extensionId);
    await expect(panel.locator('#summary-card')).toBeAttached();
    await expect(panel.locator('#summary-textarea')).toBeAttached();
    await expect(panel.locator('#paste-summary-btn')).toBeAttached();
    await expect(panel.locator('#copy-summary-btn')).toBeAttached();
    await expect(panel.locator('#cancel-summary-btn')).toBeAttached();
    await panel.close();
  });

  test('summary generating indicator exists', async () => {
    const panel = await openSidePanel(context, extensionId);
    await expect(panel.locator('#summary-generating')).toBeAttached();
    await panel.close();
  });
});
