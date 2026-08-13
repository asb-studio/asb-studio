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
   Invisible characters

   Everything a Persian text picks up on its way out of Word and cannot be
   seen once it is here. Being able to search for them is the difference
   between "something is odd about this line" and knowing what.

   Word's own Special menu has thirty entries; the rest are either English
   grammar helpers or Word's own formatting objects, which do not survive the
   trip into Markdown at all.
   -------------------------------------------------------------------------- */
export const SPECIALS = [
  { label: 'نیم‌فاصله', char: '\u200c', hint: 'ZWNJ' },
  { label: 'فاصله‌ی سخت', char: '\u00a0', hint: 'nbsp — از وُرد می‌آید و در وب فاصله‌ی عادی نیست' },
  { label: 'کشیده', char: '\u0640', hint: 'ـ' },
  { label: 'تب', char: '\t', hint: '' },
  { label: 'نشانه‌ی راست‌به‌چپ', char: '\u200f', hint: 'RLM' },
  { label: 'نشانه‌ی چپ‌به‌راست', char: '\u200e', hint: 'LRM' },
  { label: 'ی عربی', char: '\u064a', hint: 'باید ی فارسی باشد' },
  { label: 'ک عربی', char: '\u0643', hint: 'باید ک فارسی باشد' },
  { label: 'اعراب', char: '\u064e', hint: 'فتحه و مانندش' },
];

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
    this.position = root.querySelector('#find-position');
    this.wholeBox = root.querySelector('#find-whole');
    this.at = 0;
    this._buildSpecials(root.querySelector('#find-specials'));

    this.term.addEventListener('input', () => this.search());
    this.wholeBox.addEventListener('change', () => this.search());

    root.querySelector('#btn-find-close').addEventListener('click', () => this.handlers.onClose());
    root.querySelector('#btn-replace-all').addEventListener('click', () => this._replaceAll());
    root.querySelector('#btn-replace-one').addEventListener('click', () => this._replaceOne());
    root.querySelector('#btn-find-prev').addEventListener('click', () => this.step(-1));
    root.querySelector('#btn-find-next').addEventListener('click', () => this.step(1));

    /* Arrow keys walk the results while the caret stays in the search box, so
       finding the right one never means letting go of what you were typing. */
    this.term.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') { event.preventDefault(); this.step(1); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); this.step(-1); }
      else if (event.key === 'Enter') { event.preventDefault(); this.step(event.shiftKey ? -1 : 1); }
    });

    this.term.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.handlers.onClose();
    });
  }

  /* A row of buttons that drop an invisible character into the search box.
     Typing one is impossible; picking it from a list is not. */
  _buildSpecials(host) {
    if (!host) return;

    for (const item of SPECIALS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'find-special';
      button.textContent = item.label;
      button.dataset.tip = item.hint || item.label;

      button.addEventListener('click', () => {
        this.term.value += item.char;
        this.term.focus();
        this.search();
      });

      host.appendChild(button);
    }
  }

  /* Which result is selected. Every action - replace, jump, arrow key - works
     on this one, so "the match I am looking at" is never ambiguous. */
  step(delta) {
    if (this.hits.length === 0) return;

    this.at = (this.at + delta + this.hits.length) % this.hits.length;
    this._focusHit();
  }

  _focusHit() {
    const hit = this.hits[this.at];
    if (!hit) return;

    this.handlers.goTo(hit.from, hit.to);

    const rows = this.list.children;
    for (let i = 0; i < rows.length; i++) {
      rows[i].classList.toggle('find-row--at', i === this.at);
    }
    if (rows[this.at]) rows[this.at].scrollIntoView({ block: 'nearest' });

    this.position.textContent = `${fa(this.at + 1)} از ${fa(this.hits.length)}`;
  }

  /** Replaces only the selected result. */
  _replaceOne() {
    const hit = this.hits[this.at];
    if (!hit) { this.handlers.toast('اول یک مورد را انتخاب کن'); return; }

    const text = this.handlers.getText();
    this.handlers.setText(
      text.slice(0, hit.from) + this.replacement.value + text.slice(hit.to)
    );

    const wasAt = this.at;
    this.search();

    // Stay where we were, so repeated presses walk forward naturally.
    this.at = Math.min(wasAt, Math.max(0, this.hits.length - 1));
    if (this.hits.length) this._focusHit();
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
    // Persian has no letter case, so matching is always insensitive - the
    // option only ever applied to Latin words inside the text and confused
    // more than it helped.
    this.hits = findAll(text, this.term.value, { whole: this.wholeBox.checked });

    this.summary.textContent = this.term.value.trim() === ''
      ? ''
      : (this.hits.length ? `${fa(this.hits.length)} مورد` : 'چیزی پیدا نشد');
    this.summary.className = this.hits.length ? 'status--ok' : 'status--warn';

    this.list.innerHTML = '';
    if (this.at >= this.hits.length) this.at = 0;
    this.position.textContent = this.hits.length ? `${fa(this.at + 1)} از ${fa(this.hits.length)}` : '';

    this.hits.forEach((hit, index) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'find-row';
      row.innerHTML =
        `<span class="find-row__line">${fa(hit.line)}</span>`
        + `<span class="find-row__text">${esc(hit.before)}`
        + `<mark>${esc(hit.match)}</mark>${esc(hit.after)}</span>`;

      row.addEventListener('click', () => { this.at = index; this._focusHit(); });

      this.list.appendChild(row);
      if (index === this.at) row.classList.add('find-row--at');
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
