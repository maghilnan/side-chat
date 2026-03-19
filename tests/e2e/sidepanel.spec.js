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

test.describe('Side Panel Lifecycle', () => {
  test('side panel page loads successfully', async () => {
    const panel = await openSidePanel(context, extensionId);
    await expect(panel.locator('#app')).toBeVisible();
    await panel.close();
  });

  test('side panel shows input area', async () => {
    const panel = await openSidePanel(context, extensionId);
    await expect(panel.locator('#chat-input')).toBeVisible();
    await panel.close();
  });

  test('side panel shows settings gear icon', async () => {
    const panel = await openSidePanel(context, extensionId);
    await expect(panel.locator('#settings-btn')).toBeVisible();
    await panel.close();
  });

  test('side panel shows bottom bar with action buttons', async () => {
    const panel = await openSidePanel(context, extensionId);
    await expect(panel.locator('#bottom-bar')).toBeVisible();
    await expect(panel.locator('#inject-btn')).toBeVisible();
    await expect(panel.locator('#clear-btn')).toBeVisible();
    await panel.close();
  });

  test('messages area is initially empty', async () => {
    const panel = await openSidePanel(context, extensionId);
    const messagesArea = panel.locator('#messages-area');
    await expect(messagesArea).toBeVisible();
    const children = await messagesArea.locator('> *').count();
    expect(children).toBe(0);
    await panel.close();
  });

  test('send button is initially disabled', async () => {
    const panel = await openSidePanel(context, extensionId);
    await expect(panel.locator('#send-btn')).toBeDisabled();
    await panel.close();
  });
});
