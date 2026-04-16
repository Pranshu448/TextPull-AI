function extractPageContent() {
  const skipTags = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT',
    'EMBED', 'CANVAS', 'SVG', 'HEAD', 'META', 'LINK'
  ]);

  const noisySelectors = [
    'nav',
    'footer',
    'header',
    'aside',
    '[role="navigation"]',
    '[aria-hidden="true"]',
    '.sidebar',
    '.menu',
    '.nav',
    '.breadcrumb',
    '.advertisement',
    '.ads',
    '.cookie',
    '.modal',
    '.popup'
  ];

  const seen = new Set();
  const textNodes = [];

  function normalize(text) {
    return text.replace(/\s+/g, ' ').trim();
  }

  function shouldSkipElement(node) {
    if (!node || skipTags.has(node.tagName)) return true;
    if (node.matches?.(noisySelectors.join(','))) return true;

    const style = window.getComputedStyle(node);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.opacity === '0'
    ) {
      return true;
    }

    const rect = node.getBoundingClientRect();
    return rect.width === 0 && rect.height === 0;
  }

  function addText(value) {
    const normalized = normalize(value);
    if (normalized.length < 3 || seen.has(normalized)) return;
    seen.add(normalized);
    textNodes.push(normalized);
  }

  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      addText(node.textContent || '');
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (shouldSkipElement(node)) return;

    for (const child of node.childNodes) {
      walk(child);
    }
  }

  const preferredRoot =
    document.querySelector('article, main, [role="main"], .article, .post, .content') ||
    document.body;

  walk(preferredRoot);

  if (textNodes.length < 20 && preferredRoot !== document.body && document.body) {
    walk(document.body);
  }

  const description = document
    .querySelector('meta[name="description"], meta[property="og:description"]')
    ?.getAttribute('content');

  if (description) addText(description);

  for (const heading of document.querySelectorAll('h1, h2')) {
    addText(heading.textContent || '');
  }

  const text = normalize(textNodes.join('\n'));
  const wordCount = text ? text.split(/\s+/).length : 0;

  return {
    title: document.title,
    url: window.location.href,
    text,
    wordCount
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action !== 'extract-content') return false;

  try {
    sendResponse({ success: true, data: extractPageContent() });
  } catch (error) {
    sendResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown extraction error'
    });
  }

  return true;
});
