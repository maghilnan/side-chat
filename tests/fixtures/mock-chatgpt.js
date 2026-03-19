/**
 * mock-chatgpt.js — Interactive helpers for the mock ChatGPT page
 * Used by Playwright E2E tests to dynamically modify the page.
 */

(function () {
  const mainEl = document.querySelector('main');

  /**
   * Add a message to the conversation.
   * @param {'user'|'assistant'} role
   * @param {string} textContent - Plain text content for the message
   */
  window.addMessage = function (role, textContent) {
    const msgDiv = document.createElement('div');
    msgDiv.setAttribute('data-message-author-role', role);

    const proseDiv = document.createElement('div');
    proseDiv.className = 'markdown prose';

    const p = document.createElement('p');
    p.textContent = textContent;
    proseDiv.appendChild(p);

    msgDiv.appendChild(proseDiv);
    mainEl.appendChild(msgDiv);
  };

  /**
   * Simulate navigating to a new conversation by clearing all messages
   * and optionally changing the URL hash.
   * @param {string} [conversationId] - Optional new conversation ID for the URL hash
   */
  window.changeConversation = function (conversationId) {
    // Clear all messages
    while (mainEl.firstChild) {
      mainEl.removeChild(mainEl.firstChild);
    }

    // Change URL hash to simulate navigation
    if (conversationId) {
      history.pushState(null, '', '/c/' + conversationId);
    } else {
      history.pushState(null, '', '/');
    }
  };

  /**
   * Get the current text in the input field.
   * @returns {string}
   */
  window.getInputText = function () {
    const textarea = document.querySelector('#prompt-textarea');
    return textarea ? textarea.value : '';
  };

  /**
   * Set the text in the input field (simulates paste).
   * @param {string} text
   */
  window.setInputText = function (text) {
    const textarea = document.querySelector('#prompt-textarea');
    if (textarea) {
      textarea.value = text;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
  };

  /**
   * Get the number of messages currently displayed.
   * @returns {number}
   */
  window.getMessageCount = function () {
    return mainEl.querySelectorAll('[data-message-author-role]').length;
  };
})();
