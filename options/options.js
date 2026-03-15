/**
 * options.js — Settings page logic
 */

'use strict';

// ── State ─────────────────────────────────────────────────────────────────

let settings = {
  apiKeys: [],          // [{id, provider, key, label}]
  defaultModel: null,
  maxContextMessages: 20,
  summaryStyle: 'concise',
};

// ── DOM refs ──────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const dom = {
  keysList:          $('keys-list'),
  providerSelect:    $('provider-select'),
  apiKeyInput:       $('api-key-input'),
  addKeyBtn:         $('add-key-btn'),
  addKeyStatus:      $('add-key-status'),
  defaultModelSel:   $('default-model-select'),
  maxContextSlider:  $('max-context-slider'),
  maxContextValue:   $('max-context-value'),
  summaryToggles:    document.querySelectorAll('.toggle-btn[data-style]'),
  savedIndicator:    $('saved-indicator'),
};

// ── Load settings ─────────────────────────────────────────────────────────

async function loadSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(['apiKeys', 'defaultModel', 'maxContextMessages', 'summaryStyle'], result => {
      settings.apiKeys = result.apiKeys || [];
      settings.defaultModel = result.defaultModel || null;
      settings.maxContextMessages = result.maxContextMessages || 20;
      settings.summaryStyle = result.summaryStyle || 'concise';
      resolve();
    });
  });
}

async function saveSettings() {
  await chrome.storage.local.set({
    apiKeys: settings.apiKeys,
    defaultModel: settings.defaultModel,
    maxContextMessages: settings.maxContextMessages,
    summaryStyle: settings.summaryStyle,
  });
  showSavedIndicator();
}

function showSavedIndicator() {
  dom.savedIndicator.classList.add('visible');
  clearTimeout(dom.savedIndicator._timer);
  dom.savedIndicator._timer = setTimeout(() => dom.savedIndicator.classList.remove('visible'), 2000);
}

// ── Render keys list ──────────────────────────────────────────────────────

function renderKeysList() {
  dom.keysList.textContent = '';

  if (!settings.apiKeys.length) {
    const msg = document.createElement('p');
    msg.className = 'no-keys-msg';
    msg.textContent = 'No API keys configured yet.';
    dom.keysList.appendChild(msg);
    return;
  }

  settings.apiKeys.forEach((keyEntry, index) => {
    const item = document.createElement('div');
    item.className = 'key-item';

    const providerBadge = document.createElement('span');
    providerBadge.className = 'key-provider';
    providerBadge.textContent = keyEntry.provider;

    const masked = document.createElement('span');
    masked.className = 'key-masked';
    masked.textContent = maskKey(keyEntry.key);

    const status = document.createElement('span');
    status.className = 'key-status';
    status.id = `key-status-${index}`;

    const actions = document.createElement('div');
    actions.className = 'key-actions';

    const testBtn = document.createElement('button');
    testBtn.className = 'btn btn-ghost';
    testBtn.textContent = 'Test';
    testBtn.addEventListener('click', () => testKey(keyEntry, index));

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn btn-danger';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => removeKey(index));

    actions.appendChild(testBtn);
    actions.appendChild(removeBtn);

    item.appendChild(providerBadge);
    item.appendChild(masked);
    item.appendChild(status);
    item.appendChild(actions);
    dom.keysList.appendChild(item);
  });
}

function maskKey(key) {
  if (!key) return '(empty)';
  if (key.length <= 8) return '••••••••';
  return '••••••••' + key.slice(-4);
}

// ── Key operations ────────────────────────────────────────────────────────

async function addKey() {
  const provider = dom.providerSelect.value;
  const key = dom.apiKeyInput.value.trim();

  if (!key) {
    dom.addKeyStatus.textContent = 'Please enter an API key.';
    dom.addKeyStatus.style.color = 'var(--error)';
    return;
  }

  dom.addKeyBtn.disabled = true;
  dom.addKeyStatus.textContent = 'Saving…';
  dom.addKeyStatus.style.color = 'var(--text-muted)';

  // Check for duplicate provider
  const existing = settings.apiKeys.findIndex(k => k.provider === provider);
  if (existing >= 0) {
    settings.apiKeys[existing] = { provider, key };
  } else {
    settings.apiKeys.push({ provider, key });
  }

  await saveSettings();
  dom.apiKeyInput.value = '';
  dom.addKeyStatus.textContent = 'Key saved.';
  dom.addKeyStatus.style.color = 'var(--success)';
  dom.addKeyBtn.disabled = false;

  renderKeysList();
  updateDefaultModelDropdown();

  setTimeout(() => { dom.addKeyStatus.textContent = ''; }, 3000);
}

async function removeKey(index) {
  settings.apiKeys.splice(index, 1);
  if (settings.apiKeys.length === 0) settings.defaultModel = null;
  await saveSettings();
  renderKeysList();
  updateDefaultModelDropdown();
}

async function testKey(keyEntry, index) {
  const statusEl = document.getElementById(`key-status-${index}`);
  if (!statusEl) return;

  statusEl.textContent = 'Testing…';
  statusEl.className = 'key-status';

  try {
    const ok = await runKeyTest(keyEntry.provider, keyEntry.key);
    if (ok) {
      statusEl.textContent = '✓ Valid';
      statusEl.className = 'key-status ok';
    } else {
      statusEl.textContent = '✗ Invalid';
      statusEl.className = 'key-status fail';
    }
  } catch (err) {
    statusEl.textContent = '✗ Error';
    statusEl.className = 'key-status fail';
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

// ── Default model dropdown ────────────────────────────────────────────────

function updateDefaultModelDropdown() {
  dom.defaultModelSel.textContent = '';

  const noOpt = document.createElement('option');
  noOpt.value = '';
  noOpt.textContent = '(auto)';
  dom.defaultModelSel.appendChild(noOpt);

  settings.apiKeys.forEach(k => {
    const models = k.provider === 'anthropic'
      ? ['claude-sonnet-4-20250514', 'claude-opus-4-5', 'claude-haiku-4-5-20251001']
      : ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'];
    models.forEach(m => {
      const opt = document.createElement('option');
      opt.value = `${k.provider}|${m}`;
      opt.textContent = `${m} (${k.provider})`;
      if (settings.defaultModel === `${k.provider}|${m}`) opt.selected = true;
      dom.defaultModelSel.appendChild(opt);
    });
  });
}

// ── Preferences ───────────────────────────────────────────────────────────

function initPreferences() {
  // Slider
  dom.maxContextSlider.value = settings.maxContextMessages;
  dom.maxContextValue.textContent = settings.maxContextMessages;
  dom.maxContextSlider.addEventListener('input', async () => {
    settings.maxContextMessages = parseInt(dom.maxContextSlider.value);
    dom.maxContextValue.textContent = settings.maxContextMessages;
    await saveSettings();
  });

  // Summary style toggle
  dom.summaryToggles.forEach(btn => {
    if (btn.dataset.style === settings.summaryStyle) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
    btn.addEventListener('click', async () => {
      settings.summaryStyle = btn.dataset.style;
      dom.summaryToggles.forEach(b => b.classList.toggle('active', b === btn));
      await saveSettings();
    });
  });

  // Default model
  dom.defaultModelSel.addEventListener('change', async () => {
    settings.defaultModel = dom.defaultModelSel.value || null;
    await saveSettings();
  });
}

// ── Init ──────────────────────────────────────────────────────────────────

async function init() {
  await loadSettings();
  renderKeysList();
  updateDefaultModelDropdown();
  initPreferences();

  dom.addKeyBtn.addEventListener('click', addKey);

  dom.apiKeyInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') addKey();
  });
}

init().catch(console.error);
