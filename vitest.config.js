import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['tests/helpers/chrome-mock.js'],
    include: ['tests/unit/**/*.test.js'],
  },
});
