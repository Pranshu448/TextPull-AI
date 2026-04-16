const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'your', 'what',
  'when', 'where', 'which', 'about', 'into', 'there', 'their', 'them', 'will',
  'would', 'should', 'could', 'been', 'were', 'each', 'more', 'than', 'they',
  'then', 'also', 'only', 'into', 'over', 'under', 'such'
]);

export function chunkText(text, chunkSize = 1600, overlap = 180) {
  if (!text) return [];

  const chunks = [];
  let index = 0;

  while (index < text.length) {
    const end = Math.min(index + chunkSize, text.length);
    chunks.push(text.slice(index, end).trim());
    if (end === text.length) break;
    index = Math.max(end - overlap, index + 1);
  }

  return chunks.filter(Boolean);
}

export function retrieveRelevantChunks(text, query, limit = 5) {
  const chunks = chunkText(text);
  if (!query?.trim()) return chunks.slice(0, limit);

  const terms = query
    .toLowerCase()
    .split(/\W+/)
    .filter((term) => term.length > 2 && !STOP_WORDS.has(term));

  const scored = chunks.map((chunk) => {
    const lower = chunk.toLowerCase();
    let score = 0;

    for (const term of terms) {
      if (lower.includes(term)) score += 1;
    }

    return { chunk, score };
  });

  const ranked = scored
    .sort((left, right) => right.score - left.score)
    .filter((item) => item.score > 0)
    .map((item) => item.chunk);

  return (ranked.length ? ranked : chunks).slice(0, limit);
}
