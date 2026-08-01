/* ==========================================================================
   markdown/direction.js
   --------------------------------------------------------------------------
   Which way does this line of text run?

   HTML's dir="auto" answers by looking at the FIRST strong character and
   nothing else. For a footnote like

       Leni Riefenstahl: کارگردان و سینماگر آلمانی…

   the first strong character is a Latin L, so the browser calls the whole
   entry left-to-right - and a sentence that is nine tenths Persian gets laid
   out backwards, with its full stop stranded on the wrong side and a Latin
   numeral on its marker.

   The rule that actually matches how these notes are written: a note that
   CONTAINS Persian is a Persian note, wherever it happens to begin. Only a
   note with no Persian in it at all is a Latin one.

   This module must never touch the DOM.
   ========================================================================== */

/* Arabic block, Arabic Supplement, Arabic Extended-A, and the presentation
   forms - which between them cover every Persian letter and digit. */
const RTL_CHARS = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

/**
 * @param {string} text
 * @returns {'rtl'|'ltr'}
 */
export function textDirection(text) {
  return RTL_CHARS.test(String(text || '')) ? 'rtl' : 'ltr';
}

/** Strips tags before deciding, for when the text is a fragment of HTML. */
export function directionOfHtml(html) {
  return textDirection(String(html || '').replace(/<[^>]+>/g, ' '));
}
