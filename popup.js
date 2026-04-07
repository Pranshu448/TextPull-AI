// ═══════════════════════════════════════════════════════════════════
// TextPull AI - Chrome Extension Popup Script
// ═══════════════════════════════════════════════════════════════════

// ── State Management ─────────────────────────────────────────────────
const AppState = {
  selectedMode: 'tldr',
  selectedModel: 'llama3:latest',
  sessionId: `sess_${Math.random().toString(36).substr(2, 9)}`,
  lastSummary: '',
  isAnalyzing: false,
  currentTab: null,
  
  // Reset session for new analysis
  resetSession() {
    this.sessionId = `sess_${Math.random().toString(36).substr(2, 9)}`;
    this.lastSummary = '';
  }
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
    this.outputSection = this.$('outputSection');
    this.aiContent = this.$('aiContent');
    this.loadingShimmer = this.$('loadingShimmer');
    this.errorBox = this.$('errorBox');
    this.retryBtn = this.$('retryBtn');
    this.metaWords = this.$('metaWords');
    this.metaModel = this.$('metaModel');
    this.modelLabel = this.$('modelLabel');
    this.pageTitle = this.$('pageTitle');
    this.pageUrl = this.$('pageUrl');
    this.settingsBtn = this.$('settingsBtn');
    this.settingsPanel = this.$('settingsPanel');
    this.chatSection = this.$('chatSection');
    this.chatInput = this.$('chatInput');
    this.chatBtn = this.$('chatBtn');
    this.chatHistory = this.$('chatHistory');
  }
};

// ── Initialization ───────────────────────────────────────────────────
async function initializeExtension() {
  DOM.init();
  
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
  // Settings panel toggle
  DOM.settingsBtn?.addEventListener('click', () => {
    DOM.settingsPanel?.classList.toggle('open');
  });
  
  // Model selection
  document.querySelectorAll('.model-chip').forEach(chip => {
    chip.addEventListener('click', () => handleModelSelection(chip));
  });
  
  // Mode selection
  document.querySelectorAll('.mode-card').forEach(card => {
    card.addEventListener('click', () => handleModeSelection(card));
  });
  
  // Analysis buttons
  DOM.analyzeBtn?.addEventListener('click', runAnalysis);
  DOM.retryBtn?.addEventListener('click', runAnalysis);
  
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
function handleModelSelection(chip) {
  document.querySelectorAll('.model-chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
  AppState.selectedModel = chip.dataset.model || 'llama3:latest';
  if (DOM.modelLabel) DOM.modelLabel.textContent = AppState.selectedModel;
}

function handleModeSelection(card) {
  document.querySelectorAll('.mode-card').forEach(c => c.classList.remove('active'));
  card.classList.add('active');
  AppState.selectedMode = card.dataset.mode;
}

// ── Content Extraction ───────────────────────────────────────────────
async function extractPageContent() {
  if (!AppState.currentTab) {
    throw new Error('No active tab found');
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
    pageTitle: data.pageTitle || 'Untitled Page',
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
  const response = await fetch(
    `${Config.BACKEND_URL}${Config.ENDPOINTS.chat}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: AppState.sessionId,
        message: message
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
  }
  
  showError(userMessage);
}

// ── UI State Management ──────────────────────────────────────────────
function setAnalyzeButtonState(state) {
  if (!DOM.analyzeBtn) return;
  
  const states = {
    ready: {
      text: 'Analyze with Llama3',
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

function updateStatus(message) {
  if (DOM.analyzeBtn) {
    DOM.analyzeBtn.textContent = message;
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
  
  DOM.metaModel.textContent = `ollama · ${AppState.selectedModel}`;
  
  // Scroll to results
  DOM.outputSection?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
          .replace(/\*\*(.*?)\*\*/g, '<strong style="color:var(--cyan)">$1</strong>');
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
          .replace(/\*\*(.*?)\*\*/g, '<strong style="color:var(--cyan)">$1</strong>');
        return `<div class="ai-bullet">
          <span class="bullet-dot" style="font-size:0.9em">${number}</span>
          <span>${content}</span>
        </div>`;
      }

      // Regular text with bold formatting
      const formatted = trimmed.replace(
        /\*\*(.*?)\*\*/g,
        '<strong style="color:var(--text)">$1</strong>'
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
      background: 'var(--s3)',
      borderRadius: '8px 8px 0 8px',
      border: '1px solid var(--border2)'
    },
    ai: {
      alignSelf: 'flex-start',
      background: 'rgba(0,229,204,0.07)',
      borderRadius: '8px 8px 8px 0',
      border: '1px solid rgba(0,229,204,0.15)'
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