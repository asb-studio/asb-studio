/* ==========================================================================
   model/stats.js
   --------------------------------------------------------------------------
   Editorial measurements.

   A word count tells an author how long a piece is. It does not tell an
   editor anything. These do: how long the sentences run, which paragraphs
   have grown past the point a reader will follow, and which words are
   repeating close enough together to be heard as a repetition.

   Markdown syntax, attribute lists, footnote definitions and HTML comments
   are stripped first, so the numbers describe the prose and not the notation.

   This module must never touch the DOM.
   ========================================================================== */

/* Persian sentence enders, plus their Latin equivalents. */
const SENTENCE_END = /[.!?؟…]+[\s\u200c]*|[۔]/;

/* Words too common to be worth reporting as a repetition. */
const STOPWORDS = new Set([
  'از', 'به', 'با', 'در', 'که', 'را', 'این', 'آن', 'و', 'یا', 'هم', 'تا', 'بر',
  'است', 'بود', 'شد', 'شود', 'می', 'های', 'ها', 'یک', 'برای', 'اما', 'اگر',
  'چه', 'کرد', 'کند', 'خود', 'من', 'او', 'ما', 'شما', 'آنها', 'نیز', 'همه',
  'باید', 'دیگر', 'وقتی', 'روی', 'بی', 'پس', 'هر', 'چون', 'نه', 'بله',
]);

/** Removes notation so the counts describe prose only. */
function toProse(body) {
  return body
    .replace(/```[\s\S]*?```/g, ' ')          // fenced code
    .replace(/<!--[\s\S]*?-->/g, ' ')          // comments and markers
    .replace(/^\s*\/\/\/.*$/gm, ' ')           // admonition / details fences
    .replace(/^\s*\*\[[^\]]+\]:.*$/gm, ' ')    // abbreviation definitions
    .replace(/^\s*:[ \t].*$/gm, ' ')           // definition list entries
    .replace(/^\[\^[^\]]+\]:.*$/gm, ' ')       // footnote definitions
    .replace(/^\s*\{:?[^}]*\}\s*$/gm, ' ')     // attribute lines
    .replace(/\[\^[^\]]+\]/g, ' ')             // footnote references
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')     // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')   // links keep their text
    .replace(/^#{1,6}\s+/gm, '')               // heading markers
    .replace(/^[>\-*+]\s+/gm, '')              // quote and list markers
    .replace(/[*_~`]/g, '')                    // inline emphasis
    .replace(/<[^>]+>/g, ' ');                 // raw HTML
}

function words(text) {
  return text.split(/[\s\u200c]+/).map((w) => w.replace(/[^\p{L}\p{N}\u200c]/gu, '')).filter(Boolean);
}

/**
 * @param {string} body  markdown body
 * @param {object} options
 * @returns {object} the full measurement set
 */
export function measure(body, { longParagraph = 120, repeatWindow = 40 } = {}) {
  const prose = toProse(body);

  const allWords = words(prose);
  const characters = prose.replace(/\s/g, '').length;

  const paragraphs = body
    .split(/\n{2,}/)
    .map((block) => toProse(block).trim())
    .filter((block) => block.length > 0);

  const sentences = prose
    .split(SENTENCE_END)
    .map((s) => s.trim())
    .filter((s) => words(s).length > 0);

  const sentenceLengths = sentences.map((s) => words(s).length);
  const averageSentence = sentenceLengths.length
    ? sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length
    : 0;

  return {
    words: allWords.length,
    characters,
    paragraphs: paragraphs.length,
    sentences: sentences.length,
    averageSentence: Math.round(averageSentence * 10) / 10,
    longestSentence: sentenceLengths.length ? Math.max(...sentenceLengths) : 0,
    readingMinutes: Math.max(1, Math.round(allWords.length / 200)),
    longParagraphs: findLongParagraphs(body, longParagraph),
    repeats: findRepeats(body, repeatWindow),
  };
}

/* Paragraphs past the length a reader will follow without a break. Line
   numbers are counted in the original text so the studio can jump there. */
function findLongParagraphs(body, limit) {
  const found = [];
  let line = 1;

  for (const block of body.split(/\n{2,}/)) {
    const count = words(toProse(block));
    if (count.length > limit) {
      found.push({ line, words: count.length, preview: block.trim().slice(0, 60) });
    }
    line += block.split('\n').length + 1;
  }

  return found.sort((a, b) => b.words - a.words).slice(0, 12);
}

/* A word repeating within a short span is heard as a repetition even when it
   is not a mistake. Short and very common words are excluded. */
function findRepeats(body, window) {
  const prose = toProse(body);
  const list = words(prose);
  const lastSeen = new Map();
  const counts = new Map();

  list.forEach((raw, index) => {
    const word = raw.toLowerCase();
    if (word.length < 4 || STOPWORDS.has(word)) return;

    const previous = lastSeen.get(word);
    if (previous !== undefined && index - previous <= window) {
      counts.set(word, (counts.get(word) || 0) + 1);
    }
    lastSeen.set(word, index);
  });

  return [...counts.entries()]
    .map(([word, times]) => ({ word, times }))
    .sort((a, b) => b.times - a.times)
    .slice(0, 15);
}
