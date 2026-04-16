const STORAGE_KEYS = {
  theme: 'textpull_theme',
  provider: 'textpull_provider',
  providerKeys: 'textpull_provider_keys',
  backendUrl: 'textpull_backend_url'
};

const DEFAULT_BACKEND_URL = 'https://textpull-ai.onrender.com';

const state = {
  mode: 'tldr',
  provider: 'auto',
  theme: 'dark',
  backendUrl: DEFAULT_BACKEND_URL,
  providerKeys: {
    groq: '',
    gemini: ''
  },
  sessionId: crypto.randomUUID(),
  activePage: null,
  lastAnswer: ''
};

const ui = {
  apiKeyField: document.getElementById('apiKeyField'),
  apiKeyInput: document.getElementById('apiKeyInput'),
  analyzeBtn: document.getElementById('analyzeBtn'),
  backendUrlInput: document.getElementById('backendUrlInput'),
  chatForm: document.getElementById('chatForm'),
  chatInput: document.getElementById('chatInput'),
  chatHistory: document.getElementById('chatHistory'),
  chatSection: document.getElementById('chatSection'),
  copyBtn: document.getElementById('copyBtn'),
  errorBox: document.getElementById('errorBox'),
  metaText: document.getElementById('metaText'),
  pageTitle: document.getElementById('pageTitle'),
  pageUrl: document.getElementById('pageUrl'),
  providerSelect: document.getElementById('providerSelect'),
  resultSection: document.getElementById('resultSection'),
  statusText: document.getElementById('statusText'),
  summaryOutput: document.getElementById('summaryOutput'),
  themeToggleBtn: document.getElementById('themeToggleBtn')
};

document.addEventListener('DOMContentLoaded', initialize);

async function initialize() {
  await loadPreferences();
  bindEvents();
  await hydrateActiveTab();
}

function bindEvents() {
  document.querySelectorAll('.mode-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.mode-chip').forEach((item) => item.classList.remove('active'));
      chip.classList.add('active');
      state.mode = chip.dataset.mode;
    });
  });

  ui.providerSelect.addEventListener('change', async () => {
    state.provider = ui.providerSelect.value;
    await chrome.storage.local.set({ [STORAGE_KEYS.provider]: state.provider });
    syncProviderField();
  });

  ui.backendUrlInput.addEventListener('change', async () => {
    state.backendUrl = normalizeBackendUrl(ui.backendUrlInput.value);
    ui.backendUrlInput.value = state.backendUrl;
    await chrome.storage.local.set({ [STORAGE_KEYS.backendUrl]: state.backendUrl });
  });

  ui.apiKeyInput.addEventListener('input', handleApiKeyInput);

  ui.themeToggleBtn.addEventListener('click', async () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme();
    await chrome.storage.local.set({ [STORAGE_KEYS.theme]: state.theme });
  });

  ui.analyzeBtn.addEventListener('click', handleAnalyze);
  ui.copyBtn.addEventListener('click', handleCopy);
  ui.chatForm.addEventListener('submit', handleChat);
}

async function loadPreferences() {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.theme,
    STORAGE_KEYS.provider,
    STORAGE_KEYS.providerKeys,
    STORAGE_KEYS.backendUrl
  ]);
  state.theme = stored[STORAGE_KEYS.theme] || 'dark';
  state.provider = stored[STORAGE_KEYS.provider] || 'auto';
  state.backendUrl = normalizeBackendUrl(stored[STORAGE_KEYS.backendUrl] || DEFAULT_BACKEND_URL);
  state.providerKeys = {
    ...state.providerKeys,
    ...(stored[STORAGE_KEYS.providerKeys] || {})
  };
  ui.backendUrlInput.value = state.backendUrl;
  ui.providerSelect.value = state.provider;
  applyTheme();
  syncProviderField();
}

function applyTheme() {
  document.body.dataset.theme = state.theme;
}

async function handleApiKeyInput() {
  if (!['groq', 'gemini'].includes(state.provider)) return;

  state.providerKeys[state.provider] = ui.apiKeyInput.value;
  await chrome.storage.local.set({ [STORAGE_KEYS.providerKeys]: state.providerKeys });
}

function syncProviderField() {
  const needsApiKey = ['groq', 'gemini'].includes(state.provider);
  ui.apiKeyField.hidden = !needsApiKey;
  ui.apiKeyInput.value = needsApiKey ? (state.providerKeys[state.provider] || '') : '';
}

async function hydrateActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    state.activePage = tab || null;
    ui.pageTitle.textContent = tab?.title || 'Unknown page';
    ui.pageUrl.textContent = tab?.url || '—';
  } catch (error) {
    showError(`Could not read the active tab: ${getErrorMessage(error)}`);
  }
}

async function handleAnalyze() {
  if (!state.activePage?.id) {
    showError('No active tab found.');
    return;
  }

  try {
    setStatus('Extracting readable content…');
    hideError();

    const extracted = await extractCurrentPage();
    const response = await callBackend({
      type: 'analyze',
      sessionId: state.sessionId,
      mode: state.mode,
      provider: state.provider,
      apiKey: getActiveProviderKey(),
      page: extracted
    });

    state.lastAnswer = response.answer;
    renderSummary(response.answer, extracted.wordCount, response.providerUsed);
    ui.chatSection.hidden = false;
    setStatus('Summary ready.');
  } catch (error) {
    showError(getErrorMessage(error));
    setStatus('Something needs attention.');
  }
}

async function handleChat(event) {
  event.preventDefault();
  const question = ui.chatInput.value.trim();
  if (!question) return;

  appendChatMessage(question, 'user');
  ui.chatInput.value = '';

  try {
    const response = await callBackend({
      type: 'chat',
      sessionId: state.sessionId,
      provider: state.provider,
      apiKey: getActiveProviderKey(),
      question
    });

    appendChatMessage(response.answer, 'assistant');
  } catch (error) {
    appendChatMessage(getErrorMessage(error), 'assistant');
  }
}

async function handleCopy() {
  if (!state.lastAnswer) return;
  await navigator.clipboard.writeText(state.lastAnswer);
  ui.copyBtn.textContent = 'Copied';
  window.setTimeout(() => {
    ui.copyBtn.textContent = 'Copy';
  }, 1200);
}

async function extractCurrentPage() {
  if (!/^https?:/i.test(state.activePage.url || '')) {
    throw new Error('Open a regular website tab before using TextPull AI.');
  }

  await chrome.scripting.executeScript({
    target: { tabId: state.activePage.id },
    files: ['content.js']
  }).catch(() => null);

  const response = await chrome.tabs.sendMessage(state.activePage.id, { action: 'extract-content' });
  if (!response?.success) {
    throw new Error(response?.error || 'Could not extract this page.');
  }

  if (!response.data.text || response.data.wordCount < 30) {
    throw new Error('The page does not expose enough readable text yet.');
  }

  return response.data;
}

async function callBackend(payload) {
  let response;

  try {
    response = await fetch(`${state.backendUrl}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    throw new Error(
      `Could not reach the backend at ${state.backendUrl}. Check that the URL is correct, the Render service is awake, and CORS allows the extension.`
    );
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || data.message || 'Backend request failed.');
  }

  return data;
}

function renderSummary(answer, wordCount, providerUsed) {
  ui.resultSection.hidden = false;
  ui.summaryOutput.textContent = answer;
  ui.metaText.textContent = `${wordCount} words read · ${providerUsed}`;
}

function appendChatMessage(content, role) {
  const message = document.createElement('div');
  message.className = `chat-message ${role === 'user' ? 'user' : 'assistant'}`;
  message.textContent = content;
  ui.chatHistory.appendChild(message);
  ui.chatHistory.scrollTop = ui.chatHistory.scrollHeight;
}

function setStatus(message) {
  ui.statusText.textContent = message;
}

function showError(message) {
  ui.errorBox.hidden = false;
  ui.errorBox.textContent = message;
}

function hideError() {
  ui.errorBox.hidden = true;
  ui.errorBox.textContent = '';
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : 'Unexpected error.';
}

function getActiveProviderKey() {
  if (!['groq', 'gemini'].includes(state.provider)) {
    return '';
  }

  return state.providerKeys[state.provider] || '';
}

function normalizeBackendUrl(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return DEFAULT_BACKEND_URL;
  }

  return trimmed.replace(/\/+$/, '');
}
