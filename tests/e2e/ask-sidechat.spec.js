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

test.describe('Ask SideChat - Text Selection Tag', () => {
  test('selected text chip is initially hidden', async () => {
    const panel = await openSidePanel(context, extensionId);
    const chip = panel.locator('#selected-text-chip');
    await expect(chip).toHaveClass(/hidden/);
    await panel.close();
  });

  test('chip dismiss button exists', async () => {
    const panel = await openSidePanel(context, extensionId);
    await expect(panel.locator('#selected-text-chip-dismiss')).toBeAttached();
    await panel.close();
  });

  test('chip label element exists', async () => {
    const panel = await openSidePanel(context, extensionId);
    await expect(panel.locator('#selected-text-chip-label')).toBeAttached();
    await panel.close();
  });
});
