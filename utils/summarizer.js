/**
 * summarizer.js — Summary generation prompts and message builders
 */

const SUMMARY_SYSTEM_PROMPT =
  'You are a concise assistant that summarizes side-conversations. ' +
  'You will receive a series of messages from a side-chat. ' +
  'Your job is to summarize the key conclusion or answer reached in the conversation. ' +
  'Format the output as a self-contained note that could be pasted into the main conversation for context.';

const SUMMARY_STYLES = {
  concise: {
    instruction: 'Summarize the following side-conversation in 1-2 concise sentences. Focus on the conclusion or answer, not the back-and-forth. Start with "Side-note:" prefix.',
    label: 'Concise (1-2 sentences)',
  },
  detailed: {
    instruction: 'Summarize the following side-conversation in 2-4 sentences. Include the key question, reasoning, and conclusion. Start with "Side-note:" prefix.',
    label: 'Detailed (2-4 sentences)',
  },
};

/**
 * Build the messages array to send to the API for generating a summary.
 * @param {Array<{role: string, content: string}>} sideChatMessages
 * @param {'concise'|'detailed'} style
 * @returns {Array<{role: string, content: string}>}
 */
function buildSummaryMessages(sideChatMessages, style = 'concise') {
  const styleConfig = SUMMARY_STYLES[style] || SUMMARY_STYLES.concise;

  // Format the side-chat conversation as a readable block
  const conversationText = sideChatMessages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');

  return [
    {
      role: 'system',
      content: SUMMARY_SYSTEM_PROMPT,
    },
    {
      role: 'user',
      content: `${styleConfig.instruction}\n\nSide-conversation:\n\n${conversationText}`,
    },
  ];
}

/**
 * Build the system prompt for the main side-chat conversation.
 * Includes the captured ChatGPT context.
 * @param {Array<{role: string, content: string}>} contextMessages - captured from ChatGPT
 * @param {boolean} truncated - whether context was truncated
 * @returns {string} system prompt string
 */
function buildSideChatSystemPrompt(contextMessages, truncated) {
  const contextBlock = contextMessages
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');

  const truncationNote = truncated
    ? '\n\n[Note: The conversation above is truncated. Only the most recent messages are shown.]\n\n'
    : '\n\n';

  return (
    'You are continuing a conversation as a helpful assistant. ' +
    'The user has opened a side-chat to explore a tangent. ' +
    'Below is the context from their main conversation for reference. ' +
    'Answer their side-question, staying focused on what they ask without trying to continue the main conversation thread.\n\n' +
    '--- Main Conversation Context ---\n\n' +
    contextBlock +
    truncationNote +
    '--- End of Context ---'
  );
}

if (typeof module !== 'undefined') {
  module.exports = { buildSummaryMessages, buildSideChatSystemPrompt, SUMMARY_STYLES };
} else {
  self.SidechatSummarizer = { buildSummaryMessages, buildSideChatSystemPrompt, SUMMARY_STYLES };
}
