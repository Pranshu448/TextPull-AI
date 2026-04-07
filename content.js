// content.js

function extractPageText() {
  const skipTags = new Set([
    'SCRIPT','STYLE','NOSCRIPT','IFRAME','OBJECT',
    'EMBED','CANVAS','SVG','HEAD','META','LINK','NAV',
    'FOOTER','HEADER'
  ]);

  const results = [];

  function isVisible(el) {
    const style = window.getComputedStyle(el);
    return style.display !== 'none' &&
           style.visibility !== 'hidden' &&
           style.opacity !== '0';
  }

  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent.trim();
      if (text.length > 2) results.push(text);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (skipTags.has(node.tagName)) return;
    if (!isVisible(node)) return;
    for (const child of node.childNodes) walk(child);
  }

  walk(document.body);

  const deduped = results.filter((t, i) => t !== results[i - 1]);
  const fullText = deduped.join(' ').replace(/\s+/g, ' ').trim();

  return {
    text: fullText,
    title: document.title,
    url: window.location.href,
    charCount: fullText.length,
    wordCount: fullText.split(/\s+/).length
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
