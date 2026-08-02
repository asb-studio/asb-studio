/* ==========================================================================
   ui/rich-field.js
   --------------------------------------------------------------------------
   Markdown formatting inside a plain textarea.

   Footnotes and sources are full of italic book titles and bold names, and
   both are edited in small fields rather than in the main editor - so those
   fields need the same three or four shortcuts the editor has, or the author
   ends up typing asterisks by hand and counting them.

   It stays a textarea on purpose. The value is Markdown either way, and a
   contenteditable box here would mean a second, half-built editor to keep in
   step with the real one.
   ========================================================================== */

const fa = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

const WRAPS = [
  { id: 'bold', label: 'ض', title: 'ضخیم (Ctrl+B)', open: '**', close: '**', key: 'b' },
  { id: 'italic', label: 'ک', title: 'کج (Ctrl+I)', open: '*', close: '*', key: 'i' },
  { id: 'code', label: '⌗', title: 'کد', open: '`', close: '`' },
];

/** Wraps the selection inside a textarea, or drops the markers at the caret. */
export function wrapInField(field, open, close) {
  const { selectionStart: from, selectionEnd: to, value } = field;
  const selected = value.slice(from, to);

  field.value = value.slice(0, from) + open + selected + close + value.slice(to);

  // Keep the same words selected, now inside the markers - so a second press
  // of the same button removes nothing by surprise.
  field.selectionStart = from + open.length;
  field.selectionEnd = from + open.length + selected.length;

  field.focus();
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Inserts a Markdown link, using the selection as the link text. */
export function linkInField(field, url = 'https://') {
  const { selectionStart: from, selectionEnd: to, value } = field;
  const text = value.slice(from, to) || 'متن پیوند';

  field.value = `${value.slice(0, from)}[${text}](${url})${value.slice(to)}`;

  // Land the caret on the URL, which is the part that still needs typing.
  const urlAt = from + text.length + 3;
  field.selectionStart = urlAt;
  field.selectionEnd = urlAt + url.length;

  field.focus();
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Builds a small formatting bar for a textarea, and binds Ctrl+B / Ctrl+I /
 * Ctrl+K on the field itself.
 *
 * @returns {HTMLElement} the bar, for the caller to place
 */
export function attachRichControls(field) {
  const bar = document.createElement('div');
  bar.className = 'rich-bar';

  for (const wrap of WRAPS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'rich-bar__btn';
    button.textContent = wrap.label;
    button.title = wrap.title;
    button.setAttribute('aria-label', wrap.title);
    // mousedown, so the textarea does not lose its selection first.
    button.addEventListener('mousedown', (event) => {
      event.preventDefault();
      wrapInField(field, wrap.open, wrap.close);
    });
    bar.appendChild(button);
  }

  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'rich-bar__btn';
  link.textContent = '↗';
  link.title = 'پیوند (Ctrl+K)';
  link.setAttribute('aria-label', 'پیوند');
  link.addEventListener('mousedown', (event) => {
    event.preventDefault();
    linkInField(field);
  });
  bar.appendChild(link);

  field.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();

    const wrap = WRAPS.find((w) => w.key === key);
    if (wrap) { event.preventDefault(); wrapInField(field, wrap.open, wrap.close); return; }
    if (key === 'k') { event.preventDefault(); linkInField(field); }
  });

  return bar;
}
