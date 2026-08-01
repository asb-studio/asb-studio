/* ==========================================================================
   ui/table-builder.js
   --------------------------------------------------------------------------
   A table you can see while you build it.

   The first version asked two questions and dropped a skeleton of empty pipes
   into the document. That is not a table builder, it is a prompt with extra
   steps - and typing pipe characters into right-to-left prose afterwards is
   exactly the misery it was supposed to prevent.

   Here the grid is on screen: cells are typed in place, alignment is set per
   column, and the Markdown underneath updates as you go, so nothing about the
   result is a surprise.
   ========================================================================== */

import * as dialog from './dialog.js';

const fa = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

const ALIGN = {
  start: { label: 'راست', divider: '---:' },
  center: { label: 'وسط', divider: ':---:' },
  end: { label: 'چپ', divider: ':---' },
  none: { label: 'پیش‌فرض', divider: '---' },
};

/* In a right-to-left table "start" is the right edge, which Markdown writes
   as a colon on the right of the divider. */

export class TableBuilder {
  constructor() {
    this.cols = 3;
    this.rows = 2;
    this.align = ['none', 'none', 'none'];
    this.header = ['', '', ''];
    this.cells = [];
    this._resize();
  }

  _resize() {
    this.align = Array.from({ length: this.cols }, (_, i) => this.align[i] || 'none');
    this.header = Array.from({ length: this.cols }, (_, i) => this.header[i] || '');
    this.cells = Array.from({ length: this.rows }, (_, r) =>
      Array.from({ length: this.cols }, (_, c) => (this.cells[r] && this.cells[r][c]) || ''));
  }

  /** Renders the Markdown. Empty cells keep their column so the shape holds. */
  toMarkdown() {
    const cell = (text) => ` ${String(text).replace(/\|/g, '\\|').trim() || ' '} `;

    const head = '|' + this.header.map((h, i) => cell(h || `سرستون ${fa(i + 1)}`)).join('|') + '|';
    const rule = '|' + this.align.map((a) => ` ${ALIGN[a].divider} `).join('|') + '|';
    const body = this.cells.map((row) => '|' + row.map(cell).join('|') + '|').join('\n');

    return `${head}\n${rule}\n${body}`;
  }
}

/**
 * Opens the builder and returns the Markdown, or null if cancelled.
 * @returns {Promise<string|null>}
 */
export async function openTableBuilder() {
  const model = new TableBuilder();

  const root = document.createElement('div');
  root.className = 'tb';

  const render = () => {
    root.innerHTML = '';

    /* --- size controls --- */
    const bar = document.createElement('div');
    bar.className = 'tb__bar';
    bar.innerHTML = `
      <span class="tb__count">${fa(model.cols)} ستون · ${fa(model.rows)} سطر</span>`;

    const stepper = (label, get, set, min) => {
      const wrap = document.createElement('div');
      wrap.className = 'tb__stepper';
      const minus = document.createElement('button');
      minus.type = 'button'; minus.className = 'btn btn--icon'; minus.textContent = '−';
      const plus = document.createElement('button');
      plus.type = 'button'; plus.className = 'btn btn--icon'; plus.textContent = '+';
      const name = document.createElement('span');
      name.textContent = label;
      minus.addEventListener('click', () => { if (get() > min) { set(get() - 1); model._resize(); render(); } });
      plus.addEventListener('click', () => { if (get() < 12) { set(get() + 1); model._resize(); render(); } });
      wrap.append(name, minus, plus);
      return wrap;
    };

    bar.append(
      stepper('ستون', () => model.cols, (v) => { model.cols = v; }, 1),
      stepper('سطر', () => model.rows, (v) => { model.rows = v; }, 1));
    root.appendChild(bar);

    /* --- the grid --- */
    const grid = document.createElement('div');
    grid.className = 'tb__grid';
    grid.style.gridTemplateColumns = `repeat(${model.cols}, minmax(90px, 1fr))`;

    // Alignment row
    for (let c = 0; c < model.cols; c++) {
      const select = document.createElement('select');
      select.className = 'control tb__align';
      for (const [value, info] of Object.entries(ALIGN)) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = info.label;
        select.appendChild(option);
      }
      select.value = model.align[c];
      select.addEventListener('change', () => { model.align[c] = select.value; updatePreview(); });
      grid.appendChild(select);
    }

    // Header row
    for (let c = 0; c < model.cols; c++) {
      const input = document.createElement('input');
      input.className = 'control tb__cell tb__cell--head';
      input.placeholder = `سرستون ${fa(c + 1)}`;
      input.value = model.header[c];
      input.addEventListener('input', () => { model.header[c] = input.value; updatePreview(); });
      grid.appendChild(input);
    }

    // Body rows
    for (let r = 0; r < model.rows; r++) {
      for (let c = 0; c < model.cols; c++) {
        const input = document.createElement('input');
        input.className = 'control tb__cell';
        input.value = model.cells[r][c];
        input.addEventListener('input', () => { model.cells[r][c] = input.value; updatePreview(); });
        grid.appendChild(input);
      }
    }

    root.appendChild(grid);

    const preview = document.createElement('pre');
    preview.className = 'tb__preview';
    root.appendChild(preview);

    function updatePreview() { preview.textContent = model.toMarkdown(); }
    updatePreview();
  };

  render();

  const ok = await dialog.custom('ساختن جدول', root, [
    { label: 'انصراف', value: false, cancel: true },
    { label: 'درج جدول', value: true, primary: true },
  ], { wide: true });

  return ok ? model.toMarkdown() : null;
}
