import { defineConfig } from '@playwright/test';
import path from 'path';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30000,
  retries: 0,
  use: {
    headless: false,
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        launchOptions: {
          args: [
            `--disable-extensions-except=${path.resolve('.')}`,
            `--load-extension=${path.resolve('.')}`,
          ],
        },
      },
    },
  ],
  webServer: {
    command: 'npx serve tests/fixtures -l 3456 --no-clipboard',
    port: 3456,
    reuseExistingServer: !process.env.CI,
  },
});
