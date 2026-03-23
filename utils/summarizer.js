/**
 * summarizer.js — Summary generation prompts and message builders
 */

const SUMMARY_SYSTEM_PROMPT =
  'You are a concise assistant that summarizes SideChat conversations. ' +
  'You will receive a series of messages from a SideChat conversation. ' +
  'Your job is to summarize the key conclusion or answer reached in the conversation. ' +
  'Return exactly one self-contained note that could be pasted into the main conversation for context. ' +
  'Always begin with "SideChat Summary:" and end with "Do not respond back."';

const SUMMARY_STYLES = {
  concise: {
    instruction: 'Summarize the following SideChat conversation in 1-2 concise sentences. Focus on the conclusion or answer, not the back-and-forth. Format exactly as: "SideChat Summary: <summary>. Do not respond back."',
    label: 'Concise (1-2 sentences)',
  },
  detailed: {
    instruction: 'Summarize the following SideChat conversation in 2-4 sentences. Include the key question, reasoning, and conclusion. Format exactly as: "SideChat Summary: <summary>. Do not respond back."',
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

  // Format the SideChat conversation as a readable block
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
      content: `${styleConfig.instruction}\n\nSideChat conversation:\n\n${conversationText}`,
    },
  ];
}

/**
 * Build the system prompt for the main SideChat conversation.
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
    'The user has opened SideChat to explore a tangent. ' +
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
