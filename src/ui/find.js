/* ==========================================================================
   ui/find.js
   --------------------------------------------------------------------------
   Finding a word, and seeing every place it occurs.

   CodeMirror's own search bar walks matches one at a time, which answers "take
   me to the next one" but never "how often does this appear, and where". In a
   manuscript the second question is the useful one: an editor searching a word
   wants to see its habits, not visit them in order.

   So this lists them - each with the line it sits on and enough of the
   sentence around it to recognise - and every one is a click away.
   ========================================================================== */

const fa = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* Persian is written with and without the zero-width non-joiner, and with
   several shapes of the same letter. A search that does not fold these finds
   «می‌کرد» and misses «میکرد», which is not what anybody means. */
function fold(text) {
  return String(text)
    .replace(/\u200c/g, '')          // half-space
    .replace(/[\u064a\u0649]/g, '\u06cc')  // Arabic ya -> Persian
    .replace(/\u0643/g, '\u06a9')          // Arabic kaf -> Persian
    .replace(/[\u064b-\u0652]/g, '');      // harakat
}

/**
 * Every occurrence, with its position in the original text.
 * @returns {Array<{from, to, line, before, match, after}>}
 */
export function findAll(text, term, { caseSensitive = false, whole = false } = {}) {
  const needle = fold(term);
  if (!needle.trim()) return [];

  /* Folding changes lengths, so a map from folded offset back to real offset
     is kept as it goes - without it, every hit after the first half-space
     would be reported in the wrong place. */
  const map = [];
  let folded = '';

  for (let i = 0; i < text.length; i++) {
    const piece = fold(text[i]);
    for (let j = 0; j < piece.length; j++) map.push(i);
    folded += piece;
  }

  const hay = caseSensitive ? folded : folded.toLowerCase();
  const pin = caseSensitive ? needle : needle.toLowerCase();

  const out = [];
  let at = 0;

  while (out.length < 500) {
    const found = hay.indexOf(pin, at);
    if (found === -1) break;
    at = found + pin.length;

    const from = map[found];
    const to = map[found + pin.length - 1] + 1;

    if (whole) {
      const before = text[from - 1] || ' ';
      const after = text[to] || ' ';
      if (/[\w\u0600-\u06FF]/.test(before) || /[\w\u0600-\u06FF]/.test(after)) continue;
    }

    const lineStart = text.lastIndexOf('\n', from - 1) + 1;
    const line = text.slice(0, from).split('\n').length;

    out.push({
      from,
      to,
      line,
      before: text.slice(Math.max(lineStart, from - 40), from),
      match: text.slice(from, to),
      after: text.slice(to, to + 40),
    });
  }

  return out;
}

/** Replaces every occurrence, back to front so offsets stay valid. */
export function replaceAll(text, hits, replacement) {
  let out = text;
  for (let i = hits.length - 1; i >= 0; i--) {
    out = out.slice(0, hits[i].from) + replacement + out.slice(hits[i].to);
  }
  return out;
}

/* --------------------------------------------------------------------------
   The panel
   -------------------------------------------------------------------------- */

export class FindPanel {
  /**
   * @param {HTMLElement} root
   * @param {object} handlers  { getText, setText, goTo(from, to), toast }
   */
  constructor(root, handlers) {
    this.root = root;
    this.handlers = handlers;
    this.hits = [];

    this.term = root.querySelector('#find-term');
    this.replacement = root.querySelector('#find-replace');
    this.list = root.querySelector('#find-list');
    this.summary = root.querySelector('#find-summary');
    this.caseBox = root.querySelector('#find-case');
    this.wholeBox = root.querySelector('#find-whole');

    this.term.addEventListener('input', () => this.search());
    this.caseBox.addEventListener('change', () => this.search());
    this.wholeBox.addEventListener('change', () => this.search());

    root.querySelector('#btn-find-close').addEventListener('click', () => this.handlers.onClose());
    root.querySelector('#btn-replace-all').addEventListener('click', () => this._replaceAll());

    this.term.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.handlers.onClose();
    });
  }

  get isOpen() { return !this.root.hidden; }

  open(seed = '') {
    this.root.hidden = false;
    if (seed) this.term.value = seed;
    this.term.focus();
    this.term.select();
    this.search();
  }

  close() { this.root.hidden = true; }
  toggle(seed) { if (this.isOpen) this.close(); else this.open(seed); }

  search() {
    if (!this.isOpen) return;

    const text = this.handlers.getText();
    this.hits = findAll(text, this.term.value, {
      caseSensitive: this.caseBox.checked,
      whole: this.wholeBox.checked,
    });

    this.summary.textContent = this.term.value.trim() === ''
      ? ''
      : (this.hits.length ? `${fa(this.hits.length)} مورد` : 'چیزی پیدا نشد');
    this.summary.className = this.hits.length ? 'status--ok' : 'status--warn';

    this.list.innerHTML = '';

    this.hits.forEach((hit, index) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'find-row';
      row.innerHTML =
        `<span class="find-row__line">${fa(hit.line)}</span>`
        + `<span class="find-row__text">${esc(hit.before)}`
        + `<mark>${esc(hit.match)}</mark>${esc(hit.after)}</span>`;

      row.addEventListener('click', () => {
        this.handlers.goTo(hit.from, hit.to);
        for (const other of this.list.children) other.classList.remove('find-row--at');
        row.classList.add('find-row--at');
      });

      this.list.appendChild(row);
      if (index === 0) row.classList.add('find-row--at');
    });
  }

  _replaceAll() {
    if (this.hits.length === 0) { this.handlers.toast('چیزی برای جایگزینی نیست'); return; }

    const count = this.hits.length;
    this.handlers.setText(replaceAll(this.handlers.getText(), this.hits, this.replacement.value));
    this.handlers.toast(`${fa(count)} مورد جایگزین شد`);
    this.search();
  }
}
