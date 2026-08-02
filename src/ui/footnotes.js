/* ==========================================================================
   ui/footnotes.js
   --------------------------------------------------------------------------
   The footnote drawer.

   It opens along the bottom of the window, the way Word puts notes at the
   foot of the page - not in a side column, where a long note would be squeezed
   into a ribbon of text four words wide.

   Each row is the note itself: its number, an editable text field, and where
   it sits in the manuscript. Editing a row rewrites the definition in the
   Markdown; nothing is kept anywhere else, so the drawer and the document can
   never fall out of step.
   ========================================================================== */

import { readFootnotes, setFootnoteText, removeFootnote, renumberFootnotes } from '../model/footnotes.js';
import { attachRichControls } from './rich-field.js';

const fa = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

export class FootnotePanel {
  /**
   * @param {HTMLElement} root  the drawer element
   * @param {object} handlers  { getBody(), setBody(text), goToLine(n), toast(msg), confirm(title, msg) }
   */
  constructor(root, handlers) {
    this.root = root;
    this.handlers = handlers;
    this.list = root.querySelector('#footnote-list');
    this.summary = root.querySelector('#footnote-summary');

    root.querySelector('#btn-footnote-close')
      .addEventListener('click', () => this.close());
    root.querySelector('#btn-footnote-renumber')
      .addEventListener('click', () => this._renumber());
  }

  get isOpen() { return !this.root.hidden; }

  open() { this.root.hidden = false; this.render(); }
  close() { this.root.hidden = true; }
  toggle() { if (this.isOpen) this.close(); else this.open(); }

  /** Redraws from the document. Called on open and after every edit. */
  render() {
    if (!this.isOpen) return;

    const body = this.handlers.getBody();
    const { notes, issues } = readFootnotes(body);

    this.summary.textContent = notes.length === 0
      ? 'این متن پانویسی ندارد.'
      : `${fa(notes.length)} پانویس` + (issues.length ? ` · ${fa(issues.length)} ایراد` : ' · بدون ایراد');
    this.summary.className = issues.length ? 'status--warn' : 'status--ok';

    this.list.innerHTML = '';

    if (issues.length) {
      for (const issue of issues) {
        const warn = document.createElement('div');
        warn.className = 'fn-warn';
        warn.textContent = issue.message;
        this.list.appendChild(warn);
      }
    }

    if (notes.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'fn-empty';
      empty.textContent = 'با دکمه‌ی پانویس در گروه درج، اولی را بساز.';
      this.list.appendChild(empty);
      return;
    }

    for (const note of notes) this.list.appendChild(this._row(note));
  }

  _row(note) {
    const row = document.createElement('div');
    row.className = 'fn-row' + (note.refLine === null || note.defLine === null ? ' fn-row--broken' : '');

    const number = document.createElement('button');
    number.type = 'button';
    number.className = 'fn-num';
    number.textContent = /^\d+$/.test(note.id) ? fa(note.id) : note.id;
    number.dataset.tip = note.refLine ? `رفتن به خط ${fa(note.refLine)}` : 'ارجاعی در متن ندارد';
    number.disabled = note.refLine === null;
    number.addEventListener('click', () => this.handlers.goToLine(note.refLine));

    const field = document.createElement('textarea');
    field.className = 'fn-text';
    field.rows = 1;
    field.value = note.text;
    field.placeholder = 'متن پانویس…';
    field.setAttribute('aria-label', `متن پانویس ${note.id}`);

    const grow = () => {
      field.style.height = 'auto';
      field.style.height = `${field.scrollHeight}px`;
    };
    field.addEventListener('input', grow);
    requestAnimationFrame(grow);

    // Written back on blur rather than on every keystroke: rewriting the whole
    // document per character would fight the editor's undo history.
    field.addEventListener('blur', () => {
      if (field.value.trim() === note.text) return;
      this.handlers.setBody(setFootnoteText(this.handlers.getBody(), note.id, field.value));
      this.render();
    });
    field.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); field.blur(); }
      if (event.key === 'Escape') { field.value = note.text; field.blur(); }
    });

    // Footnotes are full of italic book titles and bold names, so the field
    // gets the same formatting shortcuts the main editor has.
    const controls = attachRichControls(field);

    const where = document.createElement('span');
    where.className = 'fn-where';
    where.textContent = note.refLine ? `خط ${fa(note.refLine)}` : 'بدون ارجاع';

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'fn-remove';
    remove.dataset.tip = 'حذف این پانویس و ارجاعش';
    remove.setAttribute('aria-label', `حذف پانویس ${note.id}`);
    remove.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
      stroke-linecap="round"><path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13"/></svg>`;
    remove.addEventListener('click', async () => {
      const yes = await this.handlers.confirm('حذف پانویس',
        `پانویس ${note.id} و ارجاعش در متن هر دو حذف می‌شوند.`);
      if (!yes) return;
      this.handlers.setBody(removeFootnote(this.handlers.getBody(), note.id));
      this.render();
    });

    const middle = document.createElement('div');
    middle.className = 'fn-field';
    middle.append(field, controls);

    row.append(number, middle, where, remove);
    return row;
  }

  async _renumber() {
    const { body, changed } = renumberFootnotes(this.handlers.getBody());
    if (changed === 0) { this.handlers.toast('شماره‌ها از قبل مرتب‌اند'); return; }

    const yes = await this.handlers.confirm('مرتب کردن شماره‌ها',
      `${fa(changed)} پانویس شماره‌اش عوض می‌شود تا با ترتیب متن بخواند. ` +
      'ارجاع‌ها و تعریف‌ها با هم عوض می‌شوند، پس هیچ‌کدام از هم جدا نمی‌افتند.');
    if (!yes) return;

    this.handlers.setBody(body);
    this.render();
    this.handlers.toast(`${fa(changed)} پانویس مرتب شد`);
  }
}
