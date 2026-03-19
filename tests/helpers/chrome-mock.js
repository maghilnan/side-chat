/**
 * chrome-mock.js — Vitest setup file that provides global Chrome API mocks
 */
import chrome from 'jest-chrome';
import { vi } from 'vitest';

// Assign the full jest-chrome mock to global
Object.assign(global, { chrome });

// Stub importScripts (used by service workers)
global.importScripts = vi.fn();

// Stub self (service worker global)
if (typeof self === 'undefined') {
  global.self = global;
}
