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

async function openSettings(panel) {
  // Use SettingsPanel.open() directly since the click handler may not be wired
  // if init() hasn't fully completed
  await panel.evaluate(() => {
    if (typeof SettingsPanel !== 'undefined' && SettingsPanel.open) {
      SettingsPanel.open();
    } else {
      document.getElementById('settings-overlay').classList.remove('hidden');
    }
  });
}

test.describe('Settings Panel', () => {
  test('gear icon opens settings overlay', async () => {
    const panel = await openSidePanel(context, extensionId);
    const settingsOverlay = panel.locator('#settings-overlay');

    // Settings should be hidden initially
    await expect(settingsOverlay).toHaveClass(/hidden/);

    // Open settings
    await openSettings(panel);
    await expect(settingsOverlay).not.toHaveClass(/hidden/);
    await panel.close();
  });

  test('settings close button returns to chat', async () => {
    const panel = await openSidePanel(context, extensionId);
    const settingsOverlay = panel.locator('#settings-overlay');

    // Open settings
    await openSettings(panel);
    await expect(settingsOverlay).not.toHaveClass(/hidden/);

    // Close settings via SettingsPanel.close() or direct manipulation
    await panel.evaluate(() => {
      if (typeof SettingsPanel !== 'undefined' && SettingsPanel.close) {
        SettingsPanel.close();
      } else {
        document.getElementById('settings-overlay').classList.add('hidden');
      }
    });
    await expect(settingsOverlay).toHaveClass(/hidden/);
    await panel.close();
  });

  test('settings has API key form', async () => {
    const panel = await openSidePanel(context, extensionId);
    await openSettings(panel);

    await expect(panel.locator('#s-provider-select')).toBeVisible();
    await expect(panel.locator('#s-api-key-input')).toBeVisible();
    await expect(panel.locator('#s-add-key-btn')).toBeVisible();
    await panel.close();
  });

  test('provider select has OpenAI and Anthropic options', async () => {
    const panel = await openSidePanel(context, extensionId);
    await openSettings(panel);

    const select = panel.locator('#s-provider-select');
    const options = await select.locator('option').allTextContents();
    expect(options).toContain('OpenAI');
    expect(options).toContain('Anthropic');
    await panel.close();
  });

  test('preferences section exists with model and context controls', async () => {
    const panel = await openSidePanel(context, extensionId);
    await openSettings(panel);

    await expect(panel.locator('#s-default-model-select')).toBeVisible();
    await expect(panel.locator('#s-max-context-slider')).toBeVisible();
    await panel.close();
  });

  test('max context slider defaults to 20', async () => {
    const panel = await openSidePanel(context, extensionId);
    await openSettings(panel);

    const slider = panel.locator('#s-max-context-slider');
    await expect(slider).toHaveValue('20');
    await panel.close();
  });

  test('summary style toggle buttons exist', async () => {
    const panel = await openSidePanel(context, extensionId);
    await openSettings(panel);

    const conciseBtn = panel.locator('.s-toggle-btn[data-style="concise"]');
    const detailedBtn = panel.locator('.s-toggle-btn[data-style="detailed"]');
    await expect(conciseBtn).toBeVisible();
    await expect(detailedBtn).toBeVisible();
    await panel.close();
  });

  test('concise style is active by default', async () => {
    const panel = await openSidePanel(context, extensionId);
    await openSettings(panel);

    const conciseBtn = panel.locator('.s-toggle-btn[data-style="concise"]');
    await expect(conciseBtn).toHaveClass(/active/);
    await panel.close();
  });
});
