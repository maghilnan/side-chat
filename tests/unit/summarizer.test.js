import { describe, it, expect } from 'vitest';

const {
  buildSummaryMessages,
  buildSideChatSystemPrompt,
  SUMMARY_STYLES,
} = require('../../utils/summarizer.js');

describe('SUMMARY_STYLES', () => {
  it('has concise and detailed styles', () => {
    expect(SUMMARY_STYLES.concise).toBeDefined();
    expect(SUMMARY_STYLES.detailed).toBeDefined();
  });

  it('each style has instruction and label', () => {
    for (const style of Object.values(SUMMARY_STYLES)) {
      expect(style.instruction).toBeDefined();
      expect(typeof style.instruction).toBe('string');
      expect(style.label).toBeDefined();
      expect(typeof style.label).toBe('string');
    }
  });

  it('concise instruction mentions 1-2 sentences', () => {
    expect(SUMMARY_STYLES.concise.instruction).toContain('1-2');
  });

  it('detailed instruction mentions 2-4 sentences', () => {
    expect(SUMMARY_STYLES.detailed.instruction).toContain('2-4');
  });

  it('both styles mention Side-note prefix', () => {
    expect(SUMMARY_STYLES.concise.instruction).toContain('Side-note:');
    expect(SUMMARY_STYLES.detailed.instruction).toContain('Side-note:');
  });
});

describe('buildSummaryMessages', () => {
  const sideMessages = [
    { role: 'user', content: 'What is closure?' },
    { role: 'assistant', content: 'A closure is a function with access to outer scope.' },
    { role: 'user', content: 'Can you give an example?' },
    { role: 'assistant', content: 'Sure, here is a counter example...' },
  ];

  it('returns an array with system and user messages', () => {
    const result = buildSummaryMessages(sideMessages);
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe('system');
    expect(result[1].role).toBe('user');
  });

  it('system message contains summary instructions', () => {
    const result = buildSummaryMessages(sideMessages);
    expect(result[0].content).toContain('summarize');
  });

  it('user message contains formatted conversation', () => {
    const result = buildSummaryMessages(sideMessages);
    expect(result[1].content).toContain('User: What is closure?');
    expect(result[1].content).toContain('Assistant: A closure is a function');
  });

  it('defaults to concise style', () => {
    const result = buildSummaryMessages(sideMessages);
    expect(result[1].content).toContain(SUMMARY_STYLES.concise.instruction);
  });

  it('uses detailed style when specified', () => {
    const result = buildSummaryMessages(sideMessages, 'detailed');
    expect(result[1].content).toContain(SUMMARY_STYLES.detailed.instruction);
  });

  it('falls back to concise for unknown style', () => {
    const result = buildSummaryMessages(sideMessages, 'unknown');
    expect(result[1].content).toContain(SUMMARY_STYLES.concise.instruction);
  });

  it('filters out non-user/assistant messages', () => {
    const msgs = [
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
    ];
    const result = buildSummaryMessages(msgs);
    expect(result[1].content).not.toContain('System prompt');
    expect(result[1].content).toContain('User: Hello');
  });
});

describe('buildSideChatSystemPrompt', () => {
  const contextMessages = [
    { role: 'user', content: 'Tell me about closures' },
    { role: 'assistant', content: 'Closures are functions that...' },
  ];

  it('returns a string with context block', () => {
    const result = buildSideChatSystemPrompt(contextMessages, false);
    expect(typeof result).toBe('string');
    expect(result).toContain('User: Tell me about closures');
    expect(result).toContain('Assistant: Closures are functions that...');
  });

  it('includes context boundary markers', () => {
    const result = buildSideChatSystemPrompt(contextMessages, false);
    expect(result).toContain('--- Main Conversation Context ---');
    expect(result).toContain('--- End of Context ---');
  });

  it('includes truncation note when truncated', () => {
    const result = buildSideChatSystemPrompt(contextMessages, true);
    expect(result).toContain('truncated');
  });

  it('does not include truncation note when not truncated', () => {
    const result = buildSideChatSystemPrompt(contextMessages, false);
    expect(result).not.toContain('truncated');
  });

  it('describes the side-chat context', () => {
    const result = buildSideChatSystemPrompt(contextMessages, false);
    expect(result).toContain('side-chat');
    expect(result).toContain('tangent');
  });
});
