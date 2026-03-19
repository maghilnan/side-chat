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

test.describe('Navigation & Clear', () => {
  test('clear button exists and is initially disabled', async () => {
    const panel = await openSidePanel(context, extensionId);
    const clearBtn = panel.locator('#clear-btn');
    await expect(clearBtn).toBeVisible();
    await expect(clearBtn).toBeDisabled();
    await panel.close();
  });

  test('messages area starts empty', async () => {
    const panel = await openSidePanel(context, extensionId);
    const messagesArea = panel.locator('#messages-area');
    const children = await messagesArea.locator('> *').count();
    expect(children).toBe(0);
    await panel.close();
  });
});
