/* ==========================================================================
   ui/logo.js
   --------------------------------------------------------------------------
   Draws the house mark.

   The first attempt used a CSS mask pointing at logos/asblogo.svg. That works
   right up until it does not: a mask silently renders nothing when the file
   is missing, has no viewBox, or sizes badly - and "silently nothing" is the
   worst possible failure for the one element that says whose tool this is.

   So the file is fetched, inlined, and every shape in it set to currentColor.
   The mark then follows the theme for free, and if the fetch fails there is a
   built-in horse to fall back on rather than an empty rectangle.
   ========================================================================== */

const LOGO_URL = 'logos/asblogo.svg';

/* The house mark, kept here so the studio is never without its own face. Traced
   from the publishing identity document. */
const FALLBACK = `<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="currentColor" d="M378 172.1c-46.5 5.2-97.7 22.5-133.7 45.2-4.6 2.8-8.3 5.4-8.3 5.7s2.2 1.6 4.8 3.1c5.2 2.8 38.5 21.9 39.1 22.5.2.1-1.5 4.5-3.7 9.6-8.7 20.4-13.7 42.7-14.8 66.9-1.1 23.8 1.4 41.8 11.1 80.9 10.2 41.1 14.8 70.3 16.4 105.3 1.2 24.4 1.8 26 12.9 34.8 17.5 14 27.9 19.5 34.5 18.5 7.4-1.2 35.7-20.4 40.4-27.4 3-4.6 4.3-11.2 3.4-16.8-.4-2.4-2.4-14.6-4.5-27.1-4.6-27.6-5.9-45.9-4.6-64.6 1.9-27.3 8.3-46.6 22.9-68.9 21-32.2 55.7-56.4 96.6-67.5 20.8-5.6 30.5-6.7 61.5-6.7 25.6 0 30.6.3 43 2.4 42.7 7.3 78.7 24.4 106.5 50.5 30.4 28.6 47.3 63.9 51.5 107.5 1.4 14.9.6 44-1.5 57.3-6.9 42.6-27.2 82.7-57.5 113.4-40.2 40.9-95.4 63.5-155.7 63.8-11.5 0-14.3.3-15.5 1.7-1.3 1.4-1.5 8.1-1.5 45.4 0 43.4 0 43.7 2.2 45.9 2 2 3.1 2.2 11.5 2 34.9-.9 74.1-8.4 106.6-20.3 87.2-32.1 154.3-99.7 184.9-186.5 30.9-87.6 20.9-183.1-27.3-260.4-11.2-18-22-31.6-37.5-47.2-46.2-46.4-105.4-75.6-172.1-84.8-13.2-1.8-19.8-2.1-52.6-2-20.6.1-45.1.8-54.6 1.5z"/></svg>`;

let cached = null;

async function fetchLogo() {
  if (cached !== null) return cached;
  try {
    const response = await fetch(LOGO_URL, { cache: 'force-cache' });
    if (!response.ok) throw new Error(String(response.status));
    const text = await response.text();
    if (!text.includes('<svg')) throw new Error('not an svg');
    cached = prepare(text);
  } catch {
    // Missing or unreadable file: the studio keeps its face either way.
    cached = FALLBACK;
  }
  return cached;
}

/* Strips the file's own colours so the mark inherits the theme, and makes
   sure it scales to whatever box it is put in. */
function prepare(svgText) {
  let svg = svgText
    .replace(/<\?xml[^>]*\?>/g, '')
    .replace(/<!DOCTYPE[^>]*>/g, '')
    .replace(/\sfill="(?!none)[^"]*"/g, ' fill="currentColor"')
    .replace(/\sstroke="(?!none)[^"]*"/g, ' stroke="currentColor"')
    .trim();

  if (!/fill=/.test(svg)) svg = svg.replace('<svg', '<svg fill="currentColor"');
  if (!/preserveAspectRatio=/.test(svg)) {
    svg = svg.replace('<svg', '<svg preserveAspectRatio="xMidYMid meet"');
  }
  return svg.replace('<svg', '<svg aria-hidden="true"');
}

/**
 * Fills every element carrying data-logo with the mark.
 * Safe to call more than once; the file is fetched only the first time.
 */
export async function mountLogos(root = document) {
  const svg = await fetchLogo();
  for (const slot of root.querySelectorAll('[data-logo]')) {
    slot.innerHTML = svg;
  }
}
