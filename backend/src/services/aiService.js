import { retrieveRelevantChunks } from './ragService.js';
import { appendChatTurn, getSession, saveSession } from './sessionStore.js';
import { logger } from '../utils/logger.js';

const DEFAULT_PROVIDER_ORDER = ['groq', 'gemini', 'ollama'];

const MODE_INSTRUCTIONS = {
  tldr: 'Write a crisp 2-3 sentence summary of the main point and why it matters.',
  bullets: 'Write 5-7 grounded bullet points with the most useful takeaways from the page.',
  detailed: 'Write a structured response with TOPIC, KEY POINTS, and CONCLUSION sections.',
  keywords: 'List the most important keywords and concepts directly supported by the page.'
};

export async function answerRequest(payload) {
  validatePayload(payload);

  if (payload.type === 'analyze') {
    return analyzePage(payload);
  }

  return chatWithPage(payload);
}

function validatePayload(payload) {
  if (!payload?.sessionId) {
    throw createHttpError(400, 'Missing sessionId.');
  }

  if (!['analyze', 'chat'].includes(payload?.type)) {
    throw createHttpError(400, 'type must be either "analyze" or "chat".');
  }
}

async function analyzePage(payload) {
  const page = payload.page;
  if (!page?.text || !page?.title) {
    throw createHttpError(400, 'Analyze requests need page.title and page.text.');
  }

  const prompt = [
    'You answer only from the webpage content below.',
    'Do not introduce external facts.',
    'If the page is missing something, say so plainly.',
    '',
    `TASK: ${MODE_INSTRUCTIONS[payload.mode] || MODE_INSTRUCTIONS.tldr}`,
    '',
    `PAGE TITLE: ${page.title}`,
    `PAGE URL: ${page.url}`,
    '',
    'WEBPAGE CONTENT:',
    page.text.slice(0, 50000)
  ].join('\n');

  const completion = await runProviderFallback([
    { role: 'system', content: 'You are a factual webpage analysis assistant.' },
    { role: 'user', content: prompt }
  ], payload.provider, payload.apiKey);

  saveSession(payload.sessionId, {
    page,
    providerUsed: completion.providerUsed,
    history: []
  });

  return {
    answer: completion.text,
    providerUsed: completion.providerUsed
  };
}

async function chatWithPage(payload) {
  const session = getSession(payload.sessionId);
  if (!session?.page?.text) {
    throw createHttpError(400, 'Analyze the page first to create a session.');
  }

  if (!payload.question?.trim()) {
    throw createHttpError(400, 'Question is required.');
  }

  const context = retrieveRelevantChunks(session.page.text, payload.question, 5).join('\n\n---\n\n');

  const messages = [
    {
      role: 'system',
      content: [
        'You answer questions only from the supplied page context.',
        'If the answer is not on the page, reply exactly: I cannot find this information on the page.',
        'Keep the answer concise and helpful.'
      ].join(' ')
    },
    ...(session.history || []),
    {
      role: 'user',
      content: `PAGE CONTEXT:\n${context}\n\nQUESTION:\n${payload.question}`
    }
  ];

  const completion = await runProviderFallback(
    messages,
    payload.provider || session.providerUsed,
    payload.apiKey
  );
  appendChatTurn(payload.sessionId, 'user', payload.question);
  appendChatTurn(payload.sessionId, 'assistant', completion.text);

  return {
    answer: completion.text,
    providerUsed: completion.providerUsed
  };
}

async function runProviderFallback(messages, requestedProvider = 'auto', apiKey = '') {
  const providers = getProviderOrder(requestedProvider);
  const failures = [];

  for (const provider of providers) {
    try {
      const text = await runProvider(provider, messages, apiKey);
      return { text, providerUsed: provider };
    } catch (error) {
      failures.push(`${provider}: ${error.message}`);
      logger.warn({ provider, error: error.message }, 'Provider failed, trying fallback');
    }
  }

  throw createHttpError(502, `All AI providers failed. ${failures.join(' | ')}`);
}

function getProviderOrder(requestedProvider = 'auto') {
  if (requestedProvider && requestedProvider !== 'auto') {
    return [requestedProvider];
  }

  const configured = (process.env.FALLBACK_PROVIDERS || process.env.PRIMARY_PROVIDER || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  return configured.length ? configured : DEFAULT_PROVIDER_ORDER;
}

async function runProvider(provider, messages, apiKey = '') {
  if (provider === 'groq') return runGroq(messages, apiKey);
  if (provider === 'gemini') return runGemini(messages, apiKey);
  if (provider === 'ollama') return runOllama(messages);
  throw new Error(`Unsupported provider: ${provider}`);
}

async function runGroq(messages, apiKeyOverride = '') {
  const apiKey = (apiKeyOverride || process.env.GROQ_API_KEY || '').trim();
  if (!apiKey) {
    throw createHttpError(400, 'Groq API key is missing. Add it in the extension or backend environment.');
  }

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'User-Agent': 'TextPull-AI/3.0'
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
      temperature: 0.2,
      messages
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || 'Groq request failed.');
  }

  return data?.choices?.[0]?.message?.content?.trim() || '';
}

async function runGemini(messages, apiKeyOverride = '') {
  const apiKey = (apiKeyOverride || process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    throw createHttpError(400, 'Gemini API key is missing. Add it in the extension or backend environment.');
  }

  const [systemMessage, ...rest] = messages;
  const contents = rest.map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: message.content }]
  }));

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL || 'gemini-2.5-flash'}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: systemMessage?.content || 'You are a factual assistant.' }]
        },
        contents
      })
    }
  );

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || 'Gemini request failed.');
  }

  const text = (data?.candidates || [])
    .flatMap((candidate) => candidate?.content?.parts || [])
    .map((part) => part?.text || '')
    .join('\n')
    .trim();

  if (!text) throw new Error('Gemini returned an empty response.');
  return text;
}

async function runOllama(messages) {
  const response = await fetch(`${process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434'}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OLLAMA_MODEL || 'qwen2.5-coder:3b',
      messages,
      stream: false
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error || 'Ollama request failed.');
  }

  return data?.message?.content?.trim() || '';
}

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
