/**
 * settings.js — Inline settings panel logic
 * Exposes a global `SettingsPanel` object used by sidepanel.js.
 */

'use strict';

const SettingsPanel = (() => {
  // ── State ────────────────────────────────────────────────────────────────

  let settings = {
    apiKeys: [],
    defaultModel: null,
    maxContextMessages: 20,
    summaryStyle: 'concise',
  };

  // ── DOM refs ─────────────────────────────────────────────────────────────

  const el = {
    overlay:          document.getElementById('settings-overlay'),
    closeBtn:         document.getElementById('settings-close-btn'),
    keysList:         document.getElementById('s-keys-list'),
    providerSelect:   document.getElementById('s-provider-select'),
    apiKeyInput:      document.getElementById('s-api-key-input'),
    addKeyBtn:        document.getElementById('s-add-key-btn'),
    addKeyStatus:     document.getElementById('s-add-key-status'),
    defaultModelSel:  document.getElementById('s-default-model-select'),
    maxContextSlider: document.getElementById('s-max-context-slider'),
    maxContextValue:  document.getElementById('s-max-context-value'),
    summaryToggles:   document.querySelectorAll('.s-toggle-btn[data-style]'),
    savedIndicator:   document.getElementById('s-saved-indicator'),
  };

  // ── Storage helpers ──────────────────────────────────────────────────────

  function loadFromStorage() {
    return new Promise(resolve => {
      chrome.storage.local.get(['apiKeys', 'defaultModel', 'maxContextMessages', 'summaryStyle'], result => {
        resolve({
          apiKeys: result.apiKeys || [],
          defaultModel: result.defaultModel || null,
          maxContextMessages: result.maxContextMessages || 20,
          summaryStyle: result.summaryStyle || 'concise',
        });
      });
    });
  }

  async function saveToStorage() {
    await chrome.storage.local.set({
      apiKeys: settings.apiKeys,
      defaultModel: settings.defaultModel,
      maxContextMessages: settings.maxContextMessages,
      summaryStyle: settings.summaryStyle,
    });
    showSaved();
  }

  function showSaved() {
    el.savedIndicator.classList.remove('hidden');
    clearTimeout(el.savedIndicator._timer);
    el.savedIndicator._timer = setTimeout(() => el.savedIndicator.classList.add('hidden'), 2000);
  }

  // ── API Keys ─────────────────────────────────────────────────────────────

  function renderKeysList() {
    el.keysList.textContent = '';

    if (!settings.apiKeys.length) {
      const msg = document.createElement('p');
      msg.className = 's-no-keys-msg';
      msg.textContent = 'No API keys configured yet.';
      el.keysList.appendChild(msg);
      return;
    }

    settings.apiKeys.forEach((keyEntry, index) => {
      const item = document.createElement('div');
      item.className = 's-key-item';

      const badge = document.createElement('span');
      badge.className = 's-key-provider';
      badge.textContent = keyEntry.provider;

      const masked = document.createElement('span');
      masked.className = 's-key-masked';
      masked.textContent = maskKey(keyEntry.key);

      const status = document.createElement('span');
      status.className = 's-key-status';
      status.id = `s-key-status-${index}`;

      const actions = document.createElement('div');
      actions.className = 's-key-actions';

      const testBtn = document.createElement('button');
      testBtn.className = 'btn btn-ghost btn-sm';
      testBtn.textContent = 'Test';
      testBtn.addEventListener('click', () => testKey(keyEntry, index));

      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn btn-danger btn-sm';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => removeKey(index));

      actions.appendChild(testBtn);
      actions.appendChild(removeBtn);
      item.appendChild(badge);
      item.appendChild(masked);
      item.appendChild(status);
      item.appendChild(actions);
      el.keysList.appendChild(item);
    });
  }

  function maskKey(key) {
    if (!key) return '(empty)';
    if (key.length <= 8) return '••••••••';
    return '••••••••' + key.slice(-4);
  }

  async function addKey() {
    const provider = el.providerSelect.value;
    const key = el.apiKeyInput.value.trim();

    if (!key) {
      el.addKeyStatus.textContent = 'Please enter an API key.';
      el.addKeyStatus.style.color = 'var(--error-text)';
      return;
    }

    el.addKeyBtn.disabled = true;
    el.addKeyStatus.textContent = 'Saving…';
    el.addKeyStatus.style.color = 'var(--text-muted)';

    const existing = settings.apiKeys.findIndex(k => k.provider === provider);
    if (existing >= 0) {
      settings.apiKeys[existing] = { provider, key };
    } else {
      settings.apiKeys.push({ provider, key });
    }

    await saveToStorage();
    el.apiKeyInput.value = '';
    el.addKeyStatus.textContent = 'Key saved.';
    el.addKeyStatus.style.color = 'var(--success-text)';
    el.addKeyBtn.disabled = false;

    renderKeysList();
    updateDefaultModelDropdown();

    setTimeout(() => { el.addKeyStatus.textContent = ''; }, 3000);
  }

  async function removeKey(index) {
    settings.apiKeys.splice(index, 1);
    if (settings.apiKeys.length === 0) settings.defaultModel = null;
    await saveToStorage();
    renderKeysList();
    updateDefaultModelDropdown();
  }

  async function testKey(keyEntry, index) {
    const statusEl = document.getElementById(`s-key-status-${index}`);
    if (!statusEl) return;

    statusEl.textContent = 'Testing…';
    statusEl.className = 's-key-status';

    try {
      const ok = await runKeyTest(keyEntry.provider, keyEntry.key);
      statusEl.textContent = ok ? '✓ Valid' : '✗ Invalid';
      statusEl.className = `s-key-status ${ok ? 'ok' : 'fail'}`;
    } catch {
      statusEl.textContent = '✗ Error';
      statusEl.className = 's-key-status fail';
    }
  }

  async function runKeyTest(provider, apiKey) {
    const testMessages = [{ role: 'user', content: 'Say "ok" in one word.' }];
    let url, options;

    if (provider === 'anthropic') {
      url = 'https://api.anthropic.com/v1/messages';
      options = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', messages: testMessages, max_tokens: 10 }),
      };
    } else {
      url = 'https://api.openai.com/v1/chat/completions';
      options = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model: 'gpt-4o-mini', messages: testMessages, max_tokens: 10 }),
      };
    }

    const resp = await fetch(url, options);
    return resp.ok;
  }

  // ── Default model dropdown ───────────────────────────────────────────────

  function updateDefaultModelDropdown() {
    el.defaultModelSel.textContent = '';

    const noOpt = document.createElement('option');
    noOpt.value = '';
    noOpt.textContent = '(auto)';
    el.defaultModelSel.appendChild(noOpt);

    settings.apiKeys.forEach(k => {
      const models = k.provider === 'anthropic'
        ? ['claude-sonnet-4-20250514', 'claude-opus-4-5', 'claude-haiku-4-5-20251001']
        : ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'];
      models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = `${k.provider}|${m}`;
        opt.textContent = `${m} (${k.provider})`;
        if (settings.defaultModel === `${k.provider}|${m}`) opt.selected = true;
        el.defaultModelSel.appendChild(opt);
      });
    });
  }

  // ── Preferences ──────────────────────────────────────────────────────────

  function syncPreferencesToUI() {
    el.maxContextSlider.value = settings.maxContextMessages;
    el.maxContextValue.textContent = settings.maxContextMessages;

    el.summaryToggles.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.style === settings.summaryStyle);
    });
  }

  function wirePreferenceEvents() {
    el.maxContextSlider.addEventListener('input', async () => {
      settings.maxContextMessages = parseInt(el.maxContextSlider.value);
      el.maxContextValue.textContent = settings.maxContextMessages;
      await saveToStorage();
    });

    el.summaryToggles.forEach(btn => {
      btn.addEventListener('click', async () => {
        settings.summaryStyle = btn.dataset.style;
        el.summaryToggles.forEach(b => b.classList.toggle('active', b === btn));
        await saveToStorage();
      });
    });

    el.defaultModelSel.addEventListener('change', async () => {
      settings.defaultModel = el.defaultModelSel.value || null;
      await saveToStorage();
    });
  }

  // ── Open / Close ─────────────────────────────────────────────────────────

  async function open() {
    settings = await loadFromStorage();
    renderKeysList();
    updateDefaultModelDropdown();
    syncPreferencesToUI();
    el.overlay.classList.remove('hidden');
    el.closeBtn.focus();
  }

  function close() {
    el.overlay.classList.add('hidden');
  }

  // ── Init ─────────────────────────────────────────────────────────────────

  function init() {
    el.closeBtn.addEventListener('click', close);
    el.addKeyBtn.addEventListener('click', addKey);
    el.apiKeyInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') addKey();
    });
    wirePreferenceEvents();
  }

  init();

  return { open, close };
})();
