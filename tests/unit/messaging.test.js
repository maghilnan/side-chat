import { describe, it, expect } from 'vitest';

/**
 * messaging.test.js — Contract/schema tests for Chrome runtime messages.
 *
 * These tests verify the message shapes used across components. They don't test
 * runtime behavior but ensure the message contracts are documented and validated.
 */

describe('Message schemas', () => {
  describe('Content script → Background messages', () => {
    it('GET_CONTEXT message has correct shape', () => {
      const msg = { type: 'GET_CONTEXT', maxPairs: 20 };
      expect(msg).toHaveProperty('type', 'GET_CONTEXT');
      expect(typeof msg.maxPairs).toBe('number');
    });

    it('CONTEXT_STALE message has correct shape', () => {
      const msg = { type: 'CONTEXT_STALE' };
      expect(msg).toHaveProperty('type', 'CONTEXT_STALE');
    });

    it('ASK_SIDECHAT message has correct shape', () => {
      const msg = { type: 'ASK_SIDECHAT', text: 'selected text here' };
      expect(msg).toHaveProperty('type', 'ASK_SIDECHAT');
      expect(typeof msg.text).toBe('string');
    });
  });

  describe('Background → Content script messages', () => {
    it('READ_CONTEXT message has correct shape', () => {
      const msg = { type: 'READ_CONTEXT', maxPairs: 20 };
      expect(msg).toHaveProperty('type', 'READ_CONTEXT');
      expect(typeof msg.maxPairs).toBe('number');
    });

    it('PASTE_TEXT message has correct shape', () => {
      const msg = { type: 'PASTE_TEXT', text: 'Summary text here' };
      expect(msg).toHaveProperty('type', 'PASTE_TEXT');
      expect(typeof msg.text).toBe('string');
    });

    it('PANEL_OPENED message has correct shape', () => {
      const msg = { type: 'PANEL_OPENED' };
      expect(msg).toHaveProperty('type', 'PANEL_OPENED');
    });

    it('PANEL_CLOSED message has correct shape', () => {
      const msg = { type: 'PANEL_CLOSED' };
      expect(msg).toHaveProperty('type', 'PANEL_CLOSED');
    });
  });

  describe('Side panel → Background messages', () => {
    it('GET_CONTEXT request has correct shape', () => {
      const msg = { type: 'GET_CONTEXT', maxPairs: 15 };
      expect(msg).toHaveProperty('type', 'GET_CONTEXT');
    });

    it('GET_SUMMARY request has correct shape', () => {
      const msg = {
        type: 'GET_SUMMARY',
        messages: [
          { role: 'user', content: 'Question' },
          { role: 'assistant', content: 'Answer' },
        ],
        style: 'concise',
      };
      expect(msg).toHaveProperty('type', 'GET_SUMMARY');
      expect(Array.isArray(msg.messages)).toBe(true);
      expect(['concise', 'detailed']).toContain(msg.style);
    });

    it('PASTE_SUMMARY request has correct shape', () => {
      const msg = { type: 'PASTE_SUMMARY', text: 'Side-note: ...' };
      expect(msg).toHaveProperty('type', 'PASTE_SUMMARY');
      expect(typeof msg.text).toBe('string');
    });

    it('GET_PENDING_TEXT request has correct shape', () => {
      const msg = { type: 'GET_PENDING_TEXT' };
      expect(msg).toHaveProperty('type', 'GET_PENDING_TEXT');
    });

    it('PANEL_READY request has correct shape', () => {
      const msg = { type: 'PANEL_READY' };
      expect(msg).toHaveProperty('type', 'PANEL_READY');
    });
  });

  describe('Streaming port messages', () => {
    it('CHAT message sent over api-stream port has correct shape', () => {
      const msg = {
        type: 'CHAT',
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gpt-4o',
        apiKey: 'sk-test',
        provider: 'openai',
      };
      expect(msg).toHaveProperty('type', 'CHAT');
      expect(Array.isArray(msg.messages)).toBe(true);
      expect(typeof msg.model).toBe('string');
      expect(typeof msg.apiKey).toBe('string');
      expect(['openai', 'anthropic']).toContain(msg.provider);
    });

    it('streaming chunk message has correct shape', () => {
      const msg = { text: 'Hello' };
      expect(typeof msg.text).toBe('string');
    });

    it('streaming done message has correct shape', () => {
      const msg = { done: true };
      expect(msg.done).toBe(true);
    });

    it('streaming error message has correct shape', () => {
      const msg = { error: 'API key is invalid.' };
      expect(typeof msg.error).toBe('string');
    });
  });

  describe('Panel port messages', () => {
    it('REGISTER_TAB message has correct shape', () => {
      const msg = { type: 'REGISTER_TAB', tabId: 123, windowId: 1 };
      expect(msg).toHaveProperty('type', 'REGISTER_TAB');
      expect(typeof msg.tabId).toBe('number');
      expect(typeof msg.windowId).toBe('number');
    });

    it('CONTEXT_STALE forwarded message has correct shape', () => {
      const msg = { type: 'CONTEXT_STALE' };
      expect(msg).toHaveProperty('type', 'CONTEXT_STALE');
    });

    it('SELECTED_TEXT message has correct shape', () => {
      const msg = { type: 'SELECTED_TEXT', text: 'selected text' };
      expect(msg).toHaveProperty('type', 'SELECTED_TEXT');
      expect(typeof msg.text).toBe('string');
    });

    it('TAB_ACTIVATED message has correct shape', () => {
      const msg = { type: 'TAB_ACTIVATED', tabId: 456, url: 'https://chatgpt.com/c/abc' };
      expect(msg).toHaveProperty('type', 'TAB_ACTIVATED');
      expect(typeof msg.tabId).toBe('number');
      expect(typeof msg.url).toBe('string');
    });

    it('NEW_CONVERSATION message has correct shape', () => {
      const msg = { type: 'NEW_CONVERSATION', isReload: false };
      expect(msg).toHaveProperty('type', 'NEW_CONVERSATION');
      expect(typeof msg.isReload).toBe('boolean');
    });
  });

  describe('Response shapes', () => {
    it('GET_CONTEXT success response', () => {
      const resp = {
        success: true,
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi' },
        ],
        tokenEstimate: 5,
        truncated: false,
      };
      expect(resp.success).toBe(true);
      expect(Array.isArray(resp.messages)).toBe(true);
      expect(typeof resp.tokenEstimate).toBe('number');
      expect(typeof resp.truncated).toBe('boolean');
    });

    it('GET_CONTEXT error response', () => {
      const resp = { success: false, error: 'no_chatgpt_tab' };
      expect(resp.success).toBe(false);
      expect(typeof resp.error).toBe('string');
    });

    it('GET_SUMMARY success response', () => {
      const resp = { success: true, text: 'Side-note: The conversation explored...' };
      expect(resp.success).toBe(true);
      expect(typeof resp.text).toBe('string');
    });

    it('PASTE_SUMMARY success response', () => {
      const resp = { success: true };
      expect(resp.success).toBe(true);
    });

    it('PASTE_SUMMARY failure response', () => {
      const resp = { success: false, reason: 'input_not_found' };
      expect(resp.success).toBe(false);
      expect(typeof resp.reason).toBe('string');
    });
  });
});
