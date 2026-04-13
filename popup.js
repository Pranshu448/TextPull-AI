// ═══════════════════════════════════════════════════════════════════
// TextPull AI - Chrome Extension Popup Script
// ═══════════════════════════════════════════════════════════════════

// ── State Management ─────────────────────────────────────────────────
const AppState = {
  selectedMode: 'tldr',
  theme: 'dark',
  premiumPanelOpen: false,
  premiumProvider: 'openai',
  premiumApiKey: '',
  isPremiumAnalyzing: false,
  activeProvider: 'local',
  sessionId: `sess_${Math.random().toString(36).substr(2, 9)}`,
  lastSummary: '',
  isAnalyzing: false,
  currentTab: null
};

// ── Configuration ────────────────────────────────────────────────────
const Config = {
  BACKEND_URL: 'http://127.0.0.1:8000',
  MIN_CONTENT_LENGTH: 50,
  MAX_WORDS_TO_SEND: 20000,
  ENDPOINTS: {
    analyze: '/analyze',
    chat: '/chat'
  }
};

// ── DOM Elements ─────────────────────────────────────────────────────
const DOM = {
  // Helper function
  $: (id) => document.getElementById(id),
  
  // Cache all elements
  init() {
    this.analyzeBtn = this.$('analyzeBtn');
    this.premiumToggleBtn = this.$('premiumToggleBtn');
    this.premiumPanel = this.$('premiumPanel');
    this.premiumApiKey = this.$('premiumApiKey');
    this.premiumProvider = this.$('premiumProvider');
    this.outputSection = this.$('outputSection');
    this.aiContent = this.$('aiContent');
    this.loadingShimmer = this.$('loadingShimmer');
    this.errorBox = this.$('errorBox');
    this.retryBtn = this.$('retryBtn');
    this.copyResultBtn = this.$('copyResultBtn');
    this.metaWords = this.$('metaWords');
    this.metaModel = this.$('metaModel');
    this.pageTitle = this.$('pageTitle');
    this.pageUrl = this.$('pageUrl');
    this.themeToggleBtn = this.$('themeToggleBtn');
    this.chatSection = this.$('chatSection');
    this.chatInput = this.$('chatInput');
    this.chatBtn = this.$('chatBtn');
    this.chatHistory = this.$('chatHistory');
  }
};

// ── Initialization ───────────────────────────────────────────────────
async function initializeExtension() {
  DOM.init();
  await loadPreferences();
  
  // Get current tab info
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      AppState.currentTab = tab;
      DOM.pageTitle.textContent = tab.title || 'Unknown Page';
      DOM.pageUrl.textContent = tab.url || '';
    }
  } catch (error) {
    console.error('Failed to get tab info:', error);
    showError('Failed to access current tab');
  }
  
  // Setup event listeners
  setupEventListeners();
}

// ── Event Listeners ──────────────────────────────────────────────────
function setupEventListeners() {
  DOM.themeToggleBtn?.addEventListener('click', toggleTheme);
  DOM.premiumToggleBtn?.addEventListener('click', handlePremiumButtonClick);
  DOM.premiumApiKey?.addEventListener('input', handlePremiumApiKeyInput);
  DOM.premiumProvider?.addEventListener('change', handlePremiumProviderChange);
  
  // Mode selection
  document.querySelectorAll('.mode-card').forEach(card => {
    card.addEventListener('click', () => handleModeSelection(card));
  });
  
  // Analysis buttons
  DOM.analyzeBtn?.addEventListener('click', runAnalysis);
  DOM.retryBtn?.addEventListener('click', runAnalysis);
  DOM.copyResultBtn?.addEventListener('click', copyResultToClipboard);
  
  // Chat functionality
  DOM.chatBtn?.addEventListener('click', runChat);
  DOM.chatInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      runChat();
    }
  });
}

// ── UI Handlers ──────────────────────────────────────────────────────
function handleModeSelection(card) {
  document.querySelectorAll('.mode-card').forEach(c => c.classList.remove('active'));
  card.classList.add('active');
  AppState.selectedMode = card.dataset.mode;
}

async function loadPreferences() {
  try {
    const stored = await chrome.storage.local.get([
      'theme',
      'premiumPanelOpen',
      'premiumProvider',
      'premiumApiKey'
    ]);

    AppState.theme = stored.theme === 'light' ? 'light' : 'dark';
    AppState.premiumPanelOpen = Boolean(stored.premiumPanelOpen);
    AppState.premiumProvider = stored.premiumProvider || 'openai';
    AppState.premiumApiKey = stored.premiumApiKey || '';
  } catch (error) {
    console.warn('Failed to load preferences:', error);
    AppState.theme = 'dark';
    AppState.premiumPanelOpen = false;
    AppState.premiumProvider = 'openai';
    AppState.premiumApiKey = '';
  }

  applyTheme(AppState.theme);
  syncPremiumPanel();
}

function applyTheme(theme) {
  AppState.theme = theme === 'light' ? 'light' : 'dark';
  document.body.dataset.theme = AppState.theme;

  if (DOM.themeToggleBtn) {
    const label = AppState.theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode';
    DOM.themeToggleBtn.title = label;
    DOM.themeToggleBtn.setAttribute('aria-label', label);
  }
}

async function toggleTheme() {
  const nextTheme = AppState.theme === 'light' ? 'dark' : 'light';
  applyTheme(nextTheme);

  try {
    await chrome.storage.local.set({ theme: nextTheme });
  } catch (error) {
    console.warn('Failed to save theme preference:', error);
  }
}

function syncPremiumPanel() {
  if (DOM.premiumPanel) {
    DOM.premiumPanel.classList.toggle('visible', AppState.premiumPanelOpen);
  }

  if (DOM.premiumToggleBtn) {
    DOM.premiumToggleBtn.classList.toggle('active', AppState.premiumPanelOpen);
  }

  if (DOM.premiumApiKey) {
    DOM.premiumApiKey.value = AppState.premiumApiKey;
  }

  if (DOM.premiumProvider) {
    DOM.premiumProvider.value = AppState.premiumProvider;
  }
}

async function togglePremiumPanel() {
  AppState.premiumPanelOpen = !AppState.premiumPanelOpen;
  syncPremiumPanel();

  try {
    await chrome.storage.local.set({ premiumPanelOpen: AppState.premiumPanelOpen });
  } catch (error) {
    console.warn('Failed to save premium panel state:', error);
  }
}

async function handlePremiumButtonClick() {
  if (!AppState.premiumPanelOpen) {
    await togglePremiumPanel();
    return;
  }

  await runPremiumAnalysis();
}

async function handlePremiumApiKeyInput(event) {
  AppState.premiumApiKey = event.target.value;

  try {
    await chrome.storage.local.set({ premiumApiKey: AppState.premiumApiKey });
  } catch (error) {
    console.warn('Failed to save premium API key:', error);
  }
}

async function handlePremiumProviderChange(event) {
  AppState.premiumProvider = event.target.value;

  try {
    await chrome.storage.local.set({ premiumProvider: AppState.premiumProvider });
  } catch (error) {
    console.warn('Failed to save premium provider:', error);
  }
}

// ── Content Extraction ───────────────────────────────────────────────
async function extractPageContent() {
  if (!AppState.currentTab) {
    throw new Error('No active tab found');
  }

  if (!/^https?:/i.test(AppState.currentTab.url || '')) {
    throw new Error('This page is not supported. Open a regular website tab and try again.');
  }
  
  // Inject content script
  try {
    await chrome.scripting.executeScript({
      target: { tabId: AppState.currentTab.id },
      files: ['content.js']
    });
  } catch (error) {
    console.warn('Content script may already be injected:', error);
  }
  
  // Extract text from page
  const response = await chrome.tabs.sendMessage(
    AppState.currentTab.id, 
    { action: 'extractText' }
  );
  
  if (!response?.success) {
    throw new Error('Could not extract page content');
  }
  
  return response.data;
}

// ── Content Validation ───────────────────────────────────────────────
function validateContent(data) {
  if (!data.text || data.text.trim().length < Config.MIN_CONTENT_LENGTH) {
    throw new Error('Page content is too short or empty');
  }
  
  return {
    isValid: true,
    text: data.text,
    pageTitle: data.pageTitle || data.title || 'Untitled Page',
    wordCount: data.text.split(/\s+/).length
  };
}

// ── Content Preparation ──────────────────────────────────────────────
function prepareContent(validatedData) {
  const words = validatedData.text.split(/\s+/);
  const truncated = words.length > Config.MAX_WORDS_TO_SEND
    ? words.slice(0, Config.MAX_WORDS_TO_SEND).join(' ')
    : validatedData.text;
  
  return {
    content: `Title: ${validatedData.pageTitle}\n\n${truncated}`,
    wordCount: words.length,
    wasTruncated: words.length > Config.MAX_WORDS_TO_SEND
  };
}

// ── Analysis Workflow ────────────────────────────────────────────────
async function runAnalysis() {
  if (AppState.isAnalyzing) return;
  AppState.activeProvider = 'local';
  
  AppState.isAnalyzing = true;
  hideError();
  setAnalyzeButtonState('extracting');
  
  try {
    // Step 1: Extract content from page
    updateStatus('Extracting page content...');
    const extractedData = await extractPageContent();
    
    // Step 2: Validate content
    const validatedData = validateContent(extractedData);
    
    // Step 3: Prepare content for backend
    const { content, wordCount, wasTruncated } = prepareContent(validatedData);
    
    // Update UI with metadata
    DOM.metaWords.textContent = wasTruncated 
      ? `${wordCount} words (truncated to ${Config.MAX_WORDS_TO_SEND})`
      : `${wordCount} words`;
    
    // Step 4: Show loading UI
    showLoadingState();
    updateStatus('Analyzing with AI...');
    
    // Step 5: Call backend
    const result = await analyzeWithBackend({
      session_id: AppState.sessionId,
      mode: AppState.selectedMode,
      instruction: getTaskInstruction(AppState.selectedMode),
      content: content
    });
    
    // Step 6: Display results
    displayAnalysisResult(result);
    
    // Step 7: Enable chat
    enableChat();
    
  } catch (error) {
    console.error('Analysis failed:', error);
    handleAnalysisError(error);
  } finally {
    AppState.isAnalyzing = false;
    setAnalyzeButtonState('ready');
  }
}

async function runPremiumAnalysis() {
  if (AppState.isPremiumAnalyzing) return;

  if (!AppState.premiumApiKey.trim()) {
    const providerName = AppState.premiumProvider.charAt(0).toUpperCase() + AppState.premiumProvider.slice(1);
    showError(`Paste your ${providerName} API key first.`);
    return;
  }

  if (!['gemini', 'groq'].includes(AppState.premiumProvider)) {
    showError('OpenAI and Claude are not connected yet. Use Gemini or Groq in Premium for now.');
    return;
  }

  AppState.activeProvider = AppState.premiumProvider;
  AppState.isPremiumAnalyzing = true;
  hideError();
  setPremiumButtonState('extracting');

  try {
    updatePremiumStatus('Extracting page content...');
    const extractedData = await extractPageContent();
    const validatedData = validateContent(extractedData);
    const { content, wordCount, wasTruncated } = prepareContent(validatedData);

    DOM.metaWords.textContent = wasTruncated
      ? `${wordCount} words (truncated to ${Config.MAX_WORDS_TO_SEND})`
      : `${wordCount} words`;

    showLoadingState();
    setPremiumButtonState('analyzing');

    const result = await analyzeWithBackend({
      session_id: AppState.sessionId,
      mode: AppState.selectedMode,
      instruction: getTaskInstruction(AppState.selectedMode),
      content,
      provider: AppState.premiumProvider,
      api_key: AppState.premiumApiKey
    });

    displayAnalysisResult(result);
    enableChat();
  } catch (error) {
    console.error('Premium analysis failed:', error);
    handleAnalysisError(error);
  } finally {
    AppState.isPremiumAnalyzing = false;
    setPremiumButtonState('ready');
  }
}

// ── Backend Communication ────────────────────────────────────────────
async function analyzeWithBackend(payload) {
  const response = await fetch(
    `${Config.BACKEND_URL}${Config.ENDPOINTS.analyze}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }
  );
  
  if (!response.ok) {
    const errorData = await parseErrorResponse(response);
    throw new Error(`Backend error: ${errorData}`);
  }
  
  const data = await response.json();
  
  if (data.error) {
    throw new Error(`Analysis error: ${data.error}`);
  }
  
  if (!data.result || data.result.trim().length === 0) {
    throw new Error('Backend returned empty result');
  }
  
  return data.result;
}

async function chatWithBackend(message) {
  const isPremiumSession = ['gemini', 'groq'].includes(AppState.activeProvider);
  const response = await fetch(
    `${Config.BACKEND_URL}${Config.ENDPOINTS.chat}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: AppState.sessionId,
        message: message,
        provider: isPremiumSession ? AppState.activeProvider : null,
        api_key: isPremiumSession ? AppState.premiumApiKey : null
      })
    }
  );
  
  if (!response.ok) {
    const errorData = await parseErrorResponse(response);
    throw new Error(errorData);
  }
  
  const data = await response.json();
  
  if (data.error) {
    throw new Error(data.error);
  }
  
  return data.result;
}

// ── Error Handling ───────────────────────────────────────────────────
async function parseErrorResponse(response) {
  try {
    const text = await response.text();
    const json = JSON.parse(text);
    return json.detail || json.error || text;
  } catch {
    return response.statusText || 'Unknown error';
  }
}

function handleAnalysisError(error) {
  hideLoadingState();
  
  let userMessage = error.message;
  
  // Provide helpful error messages
  if (error.message.includes('fetch')) {
    userMessage = 'Cannot connect to backend. Make sure the Python server is running on port 8000.';
  } else if (error.message.includes('extract')) {
    userMessage = 'Failed to extract page content. Try refreshing the page.';
  } else if (error.message.includes('not supported')) {
    userMessage = error.message;
  } else if (error.message.includes('too short or empty')) {
    userMessage = 'This page does not expose enough readable text yet. Let the page finish loading, then try again.';
  }
  
  showError(userMessage);
}

// ── UI State Management ──────────────────────────────────────────────
function setAnalyzeButtonState(state) {
  if (!DOM.analyzeBtn) return;
  
  const states = {
    ready: {
      text: 'Analyze Page',
      disabled: false
    },
    extracting: {
      text: 'Extracting page...',
      disabled: true
    },
    analyzing: {
      text: 'Analyzing with AI...',
      disabled: true
    }
  };
  
  const config = states[state] || states.ready;
  DOM.analyzeBtn.textContent = config.text;
  DOM.analyzeBtn.disabled = config.disabled;
}

function setPremiumButtonState(state) {
  if (!DOM.premiumToggleBtn) return;

  const labelNode = DOM.premiumToggleBtn.childNodes[DOM.premiumToggleBtn.childNodes.length - 1];
  const states = {
    ready: {
      text: ' Analyze with Premium',
      disabled: false
    },
    extracting: {
      text: ' Extracting page...',
      disabled: true
    },
    analyzing: {
      text: ' Analyzing with Premium...',
      disabled: true
    }
  };

  const config = states[state] || states.ready;
  if (labelNode) {
    labelNode.textContent = config.text;
  }
  DOM.premiumToggleBtn.disabled = config.disabled;
}

function updateStatus(message) {
  if (DOM.analyzeBtn) {
    DOM.analyzeBtn.textContent = message;
  }
}

function updatePremiumStatus(message) {
  if (!DOM.premiumToggleBtn) return;
  const labelNode = DOM.premiumToggleBtn.childNodes[DOM.premiumToggleBtn.childNodes.length - 1];
  if (labelNode) {
    labelNode.textContent = ` ${message}`;
  }
}

function showLoadingState() {
  DOM.outputSection?.classList.add('visible');
  DOM.loadingShimmer.style.display = 'block';
  DOM.aiContent.innerHTML = '';
}

function hideLoadingState() {
  DOM.loadingShimmer.style.display = 'none';
}

function showError(message) {
  DOM.outputSection?.classList.remove('visible');
  DOM.errorBox.textContent = `⚠ ${message}`;
  DOM.errorBox?.classList.add('show');
}

function hideError() {
  DOM.errorBox?.classList.remove('show');
}

// ── Result Display ───────────────────────────────────────────────────
function displayAnalysisResult(result) {
  AppState.lastSummary = result;
  
  hideLoadingState();
  
  const resultElement = document.createElement('div');
  resultElement.innerHTML = formatAIResponse(result);
  DOM.aiContent.innerHTML = '';
  DOM.aiContent.appendChild(resultElement);
  
  DOM.metaModel.textContent = AppState.activeProvider === 'gemini'
    ? 'Gemini premium summary'
    : AppState.activeProvider === 'groq'
      ? 'Groq premium summary'
    : 'Grounded webpage summary';
  
  // Scroll to results
  DOM.outputSection?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function copyResultToClipboard() {
  if (!AppState.lastSummary || !DOM.copyResultBtn) return;

  const originalLabel = DOM.copyResultBtn.textContent;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(AppState.lastSummary);
    } else {
      const helper = document.createElement('textarea');
      helper.value = AppState.lastSummary;
      helper.setAttribute('readonly', '');
      helper.style.position = 'absolute';
      helper.style.left = '-9999px';
      document.body.appendChild(helper);
      helper.select();
      document.execCommand('copy');
      document.body.removeChild(helper);
    }

    DOM.copyResultBtn.textContent = 'Copied';
    DOM.copyResultBtn.classList.add('success');
  } catch (error) {
    console.error('Copy failed:', error);
    DOM.copyResultBtn.textContent = 'Failed';
  }

  window.setTimeout(() => {
    if (!DOM.copyResultBtn) return;
    DOM.copyResultBtn.textContent = originalLabel;
    DOM.copyResultBtn.classList.remove('success');
  }, 1600);
}

// ── Task Instructions ────────────────────────────────────────────────
function getTaskInstruction(mode) {
  const instructions = {
    tldr: `Provide a 2-3 sentence summary of the main topic and key information.

Rules:
- Use ONLY the facts extracted above
- Be precise and factual
- No speculation or external context
- Focus on the core message`,

    bullets: `List 5-7 key points from the extracted facts.

Rules:
- Each bullet must be directly supported by the facts above
- Include specific details (numbers, names, dates) when available
- No interpretations or assumptions
- If fewer than 5 key points exist, list only what's available
- Prioritize the most important information`,

    detailed: `Create a structured analysis with these sections:

### TOPIC
[State the main subject in 1 sentence based on extracted facts]

### KEY POINTS
[List 4-6 important facts with specific details]

### CONCLUSION
[Summarize in 2-3 sentences using only extracted information]

Rules:
- Every statement must trace back to the extracted facts
- Include specific data points when available
- Acknowledge if information is limited
- Maintain objectivity`,

    keywords: `Identify the following based ONLY on extracted facts:

### KEYWORDS
[5-8 main terms/concepts that appear in the facts]

### IMPORTANT CONCEPTS
[3-5 core ideas directly mentioned in the text]

### AUDIENCE
[Who this content is for, based only on clues in the facts]

Rules:
- Extract, don't invent
- If audience is unclear, state "Not explicitly mentioned"
- Use actual terms from the source
- Prioritize domain-specific terminology`
  };

  return instructions[mode] || instructions.tldr;
}

// ── Response Formatting ──────────────────────────────────────────────
function formatAIResponse(text) {
  if (!text) return '<div style="color:var(--error)">No response received</div>';

  return text
    .split('\n')
    .map(line => {
      const trimmed = line.trim();
      if (!trimmed) return '<div style="height:10px"></div>';

      // Markdown Headings (### Summary, ## Topic, etc.)
      if (/^#{1,3}\s/.test(trimmed)) {
        const heading = trimmed
          .replace(/^#+\s/, '')
          .replace(/\*\*(.*?)\*\*/g, '$1');
        return `<div class="ai-section-title">${escapeHtml(heading)}</div>`;
      }

      // Markdown Bullets (- or *)
      if (/^[-*]\s/.test(trimmed)) {
        const content = trimmed
          .substring(2)
          .replace(/\*\*(.*?)\*\*/g, '<strong style="color:var(--accent-primary)">$1</strong>');
        return `<div class="ai-bullet">
          <span class="bullet-dot">•</span>
          <span>${content}</span>
        </div>`;
      }

      // Numbered Lists (1. 2. 3.)
      if (/^\d+\.\s/.test(trimmed)) {
        const number = trimmed.match(/^\d+\./)[0];
        const content = trimmed
          .replace(/^\d+\.\s/, '')
          .replace(/\*\*(.*?)\*\*/g, '<strong style="color:var(--accent-primary)">$1</strong>');
        return `<div class="ai-bullet">
          <span class="bullet-dot" style="font-size:0.9em">${number}</span>
          <span>${content}</span>
        </div>`;
      }

      // Regular text with bold formatting
      const formatted = trimmed.replace(
        /\*\*(.*?)\*\*/g,
        '<strong style="color:var(--text-primary)">$1</strong>'
      );
      return `<div style="margin-bottom:6px">${formatted}</div>`;
    })
    .join('');
}

// Security helper
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ── Chat Functionality ───────────────────────────────────────────────
function enableChat() {
  if (DOM.chatSection) {
    DOM.chatSection.style.display = 'block';
  }
  if (DOM.chatHistory) {
    DOM.chatHistory.innerHTML = '';
  }
}

async function runChat() {
  if (!DOM.chatInput || !DOM.chatHistory) return;
  
  const message = DOM.chatInput.value.trim();
  if (!message) return;
  
  // Clear input and disable button
  DOM.chatInput.value = '';
  DOM.chatBtn.disabled = true;
  DOM.chatBtn.innerHTML = '<span style="opacity:0.6">...</span>';
  
  // Display user message
  appendChatMessage(message, 'user');
  
  try {
    // Get AI response
    const response = await chatWithBackend(message);
    
    // Display AI response
    appendChatMessage(response, 'ai');
    
  } catch (error) {
    console.error('Chat error:', error);
    appendChatMessage(`Error: ${error.message}`, 'error');
  } finally {
    // Re-enable input
    DOM.chatBtn.disabled = false;
    DOM.chatBtn.textContent = 'Ask';
    DOM.chatHistory.scrollTop = DOM.chatHistory.scrollHeight;
  }
}

function appendChatMessage(content, type) {
  const bubble = document.createElement('div');
  
  const styles = {
    user: {
      alignSelf: 'flex-end',
      background: 'var(--bg-elevated)',
      borderRadius: '8px 8px 0 8px',
      border: '1px solid var(--border-medium)'
    },
    ai: {
      alignSelf: 'flex-start',
      background: 'rgba(127, 127, 127, 0.08)',
      borderRadius: '8px 8px 8px 0',
      border: '1px solid var(--border-medium)'
    },
    error: {
      alignSelf: 'flex-start',
      background: 'rgba(255,100,100,0.1)',
      borderRadius: '8px',
      border: '1px solid rgba(255,100,100,0.3)',
      color: 'var(--error)'
    }
  };
  
  const style = styles[type] || styles.user;
  
  Object.assign(bubble.style, {
    ...style,
    padding: '8px 12px',
    maxWidth: type === 'user' ? '85%' : '90%',
    fontSize: '12px',
    lineHeight: '1.5',
    marginBottom: '8px'
  });
  
  // Format content based on type
  if (type === 'ai') {
    bubble.innerHTML = formatAIResponse(content);
  } else {
    bubble.textContent = content;
  }
  
  DOM.chatHistory.appendChild(bubble);
  DOM.chatHistory.scrollTop = DOM.chatHistory.scrollHeight;
}

// ── Response Validation (Optional Debug Tool) ────────────────────────
function validateResponse(text) {
  const hallucinationMarkers = [
    'it is known that',
    'generally',
    'typically',
    'usually',
    'experts say',
    'studies show',
    'research indicates',
    'it is believed',
    'commonly accepted',
    'widely known'
  ];
  
  const warnings = [];
  const lowerText = text.toLowerCase();
  
  hallucinationMarkers.forEach(marker => {
    if (lowerText.includes(marker)) {
      warnings.push(`⚠ Potential hallucination: "${marker}"`);
    }
  });
  
  if (warnings.length > 0) {
    console.warn('Hallucination check:', warnings);
  }
  
  return warnings;
}

// ── Start Extension ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', initializeExtension);
