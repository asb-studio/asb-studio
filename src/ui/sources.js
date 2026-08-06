/* ==========================================================================
   ui/sources.js
   --------------------------------------------------------------------------
   The sources panel.

   Sits in the same drawer as the footnotes, because it is the same kind of
   work: short entries, edited at the foot of a piece, full of italic titles
   and links. Each row carries the formatting controls for that reason.

   The panel writes the block build.py expects - the right heading, a numbered
   list - so a source list never has to be typed from memory again.
   ========================================================================== */

import { readSources, writeSources } from '../model/sources.js';
import { attachRichControls } from './rich-field.js';

const fa = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

export class SourcePanel {
  /**
   * @param {HTMLElement} root  the drawer element
   * @param {object} handlers  { getBody(), setBody(text), goToLine(n), toast(msg), confirm(t, m) }
   */
  constructor(root, handlers) {
    this.root = root;
    this.handlers = handlers;
    this.list = root.querySelector('#source-list');
    this.summary = root.querySelector('#source-summary');

    // Through the handler - see the note in ui/footnotes.js.
    root.querySelector('#btn-source-close').addEventListener('click', () => this.handlers.onClose());
    root.querySelector('#btn-source-add').addEventListener('click', () => this._add());
  }

  get isOpen() { return !this.root.hidden; }

  open() { this.root.hidden = false; this.render(); }
  close() { this.root.hidden = true; }
  toggle() { if (this.isOpen) this.close(); else this.open(); }

  render() {
    if (!this.isOpen) return;

    const { present, items, headingLine } = readSources(this.handlers.getBody());

    this.summary.textContent = !present
      ? 'این متن سرچشمه‌ای ندارد'
      : `${fa(items.length)} سرچشمه`;
    this.summary.className = 'status--ok';

    this.list.innerHTML = '';

    if (!present || items.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'fn-empty';
      empty.textContent = 'با دکمه‌ی «افزودن سرچشمه» اولی را بساز. عنوان بخش و شماره‌گذاری خودکار ساخته می‌شود.';
      this.list.appendChild(empty);
      return;
    }

    items.forEach((text, index) => this.list.appendChild(this._row(text, index, items, headingLine)));
  }

  _row(text, index, items, headingLine) {
    const row = document.createElement('div');
    row.className = 'fn-row';

    const number = document.createElement('button');
    number.type = 'button';
    number.className = 'fn-num';
    number.textContent = fa(index + 1);
    number.dataset.tip = 'رفتن به بخش سرچشمه‌ها';
    number.addEventListener('click', () => this.handlers.goToLine(headingLine));

    const field = document.createElement('textarea');
    field.className = 'fn-text';
    field.rows = 1;
    field.value = text;
    field.placeholder = 'نام منبع یا پیوند…';
    field.setAttribute('aria-label', `سرچشمه‌ی ${index + 1}`);

    const grow = () => {
      field.style.height = 'auto';
      field.style.height = `${field.scrollHeight}px`;
    };
    field.addEventListener('input', grow);
    requestAnimationFrame(grow);

    // Written back on blur, not per keystroke: rewriting the whole document
    // on every character would fight the editor's undo history.
    field.addEventListener('blur', () => {
      if (field.value.trim() === text) return;
      const next = [...items];
      next[index] = field.value;
      this.handlers.setBody(writeSources(this.handlers.getBody(), next));
      this.render();
    });
    field.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { field.value = text; field.blur(); }
    });

    const controls = attachRichControls(field);

    const middle = document.createElement('div');
    middle.className = 'fn-field';
    middle.append(field, controls);

    const where = document.createElement('span');
    where.className = 'fn-where';
    where.textContent = '';

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'fn-remove';
    remove.dataset.tip = 'حذف این سرچشمه';
    remove.setAttribute('aria-label', `حذف سرچشمه‌ی ${index + 1}`);
    remove.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
      stroke-linecap="round"><path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13"/></svg>`;
    remove.addEventListener('click', async () => {
      const yes = await this.handlers.confirm('حذف سرچشمه', 'این سرچشمه از فهرست برداشته می‌شود.');
      if (!yes) return;
      this.handlers.setBody(writeSources(this.handlers.getBody(), items.filter((_, i) => i !== index)));
      this.render();
    });

    row.append(number, middle, where, remove);
    return row;
  }

  _add() {
    const { items } = readSources(this.handlers.getBody());
    this.handlers.setBody(writeSources(this.handlers.getBody(), [...items, 'منبع تازه']));
    this.render();

    const last = this.list.querySelector('.fn-row:last-of-type .fn-text');
    if (last) { last.focus(); last.select(); }
  }
}
