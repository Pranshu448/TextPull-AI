function extractPageText() {
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
  const results = [];

  function normalize(text) {
    return text.replace(/\s+/g, ' ').trim();
  }

  function shouldSkipElement(el) {
    if (!el || skipTags.has(el.tagName)) return true;
    if (el.matches?.(noisySelectors.join(','))) return true;

    const style = window.getComputedStyle(el);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.opacity === '0'
    ) {
      return true;
    }

    const rect = el.getBoundingClientRect();
    return rect.width === 0 && rect.height === 0;
  }

  function addText(text) {
    const normalized = normalize(text);
    if (normalized.length < 3 || seen.has(normalized)) return;
    seen.add(normalized);
    results.push(normalized);
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

  const root =
    document.querySelector('article, main, [role="main"], .article, .post, .content') ||
    document.body;

  walk(root);

  if (results.length < 20 && root !== document.body && document.body) {
    walk(document.body);
  }

  const metaDescription = document
    .querySelector('meta[name="description"], meta[property="og:description"]')
    ?.getAttribute('content');

  if (metaDescription) {
    addText(metaDescription);
  }

  const headings = Array.from(document.querySelectorAll('h1, h2'))
    .map((el) => el.textContent || '')
    .map(normalize)
    .filter(Boolean);

  headings.forEach(addText);

  const fullText = normalize(results.join('\n'));
  const words = fullText ? fullText.split(/\s+/) : [];

  return {
    text: fullText,
    title: document.title,
    pageTitle: document.title,
    url: window.location.href,
    charCount: fullText.length,
    wordCount: words.length
  };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'extractText') {
    try {
      sendResponse({ success: true, data: extractPageText() });
    } catch (e) {
      sendResponse({ success: false, error: e.message });
    }
  }
  return true;
});
