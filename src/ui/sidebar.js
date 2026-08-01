/* ==========================================================================
   ui/sidebar.js
   --------------------------------------------------------------------------
   The frontmatter panel.

   THE RULE THIS PANEL LIVES BY: it edits the fields it knows and does not
   touch anything else. A file written by hand, or by a future version of
   build.py, can carry keys this form has never heard of - roles, socials,
   whatever comes next - and they come out the far side untouched. They are
   listed to the author as preserved so nothing feels lost.

   Values are written through frontmatter.set(), which rewrites one line and
   leaves the rest of the block byte for byte as it was found.
   ========================================================================== */

import {
  CATEGORIES, LEGACY_CATEGORIES, LANGUAGES, KNOWN_FIELDS,
  CREATOR_FIELDS, CREATOR_ROLES, SOCIAL_NETWORKS,
  PERSIAN_MONTHS, newBookId, suggestSlug,
} from '../model/schema.js';
import { detectType, setType, DOC_TYPES } from '../model/doctype.js';

const faDigits = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const enDigits = (s) => String(s).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));

const CHEVRON = `<svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>`;

/* Which fields live in which card, per kind of document. */
const CREATOR_CARDS = [
  { id: 'who', title: 'پدیدآورنده', fields: ['name', 'slug'] },
  { id: 'roles', title: 'نقش‌ها', fields: ['roles'] },
  { id: 'socials', title: 'شبکه‌ها و نشانی‌ها', fields: ['socials'] },
  { id: 'portrait', title: 'عکس', fields: ['image'] },
];

const CARDS = [
  { id: 'identity', title: 'شناسنامه', fields: ['title', 'slug', 'category', 'series', 'language'] },
  { id: 'people', title: 'پدیدآورندگان', fields: ['author', 'translator', 'editor'] },
  { id: 'publish', title: 'انتشار', fields: ['date', 'tags', 'summary'] },
  { id: 'access', title: 'دسترسی', fields: ['reader', 'premium', 'price'] },
  { id: 'media', title: 'تصاویر', fields: ['cover', 'image'] },
  { id: 'system', title: 'سیستمی', fields: ['book_id'] },
];

const LABELS = {
  name: 'نام', roles: 'نقش‌ها', socials: 'شبکه‌ها',
  title: 'عنوان', slug: 'اسلاگ (نام فایل)', category: 'دسته‌بندی', series: 'مجموعه',
  language: 'زبان', author: 'نویسنده', translator: 'مترجم', editor: 'ویراستار',
  date: 'تاریخ انتشار', tags: 'هشتگ‌ها', summary: 'خلاصه', reader: 'حالت مطالعه',
  premium: 'اثر پولی', price: 'قیمت (تومان)', cover: 'کاور (۳:۴)', image: 'عکس پدیدآورنده',
  book_id: 'شناسه‌ی کتاب',
};

export class Sidebar {
  /**
   * @param {HTMLElement} root  the <aside> to fill
   * @param {() => void} onChange  called after any field is edited
   */
  constructor(root, onChange) {
    this.root = root;
    this.onChange = onChange;
    this.doc = null;
    this.collapsed = this._loadCollapsed();
  }

  /** Redraws the whole panel for a document. */
  render(doc) {
    this.doc = doc;
    this.type = detectType(doc);
    this.root.innerHTML = '';

    this.root.appendChild(this._typePicker());

    const cards = this.type === 'creator' ? CREATOR_CARDS : CARDS;
    for (const card of cards) this.root.appendChild(this._card(card));

    this.root.appendChild(this._preservedCard());
  }

  /* The type is worked out from the frontmatter, but the author can say
     otherwise - and choosing "پدیدآورنده" writes category: creators, which is
     what makes build.py take the profile branch regardless of the folder. */
  _typePicker() {
    const field = document.createElement('div');
    field.className = 'field type-picker';

    const label = document.createElement('label');
    label.textContent = 'نوع سند';

    const row = document.createElement('div');
    row.className = 'type-picker__row';

    for (const [id, title] of Object.entries(DOC_TYPES)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'type-picker__option';
      button.textContent = title;
      button.setAttribute('aria-pressed', String(this.type === id));
      button.addEventListener('click', () => {
        if (this.type === id) return;
        setType(this.doc, id);
        this.onChange();
        this.render(this.doc);
      });
      row.appendChild(button);
    }

    const hint = document.createElement('div');
    hint.className = 'field__hint';
    hint.textContent = this.type === 'creator'
      ? 'صفحه‌ی یک آدم. متنی که می‌نویسی، زندگی‌نامه‌ی اوست.'
      : 'داستان، جستار یا مطلب مجله.';

    field.append(label, row, hint);
    return field;
  }

  /* --- cards ------------------------------------------------------------- */

  _card({ id, title, fields }) {
    const card = document.createElement('section');
    card.className = 'card' + (this.collapsed.has(id) ? ' is-collapsed' : '');

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'card__toggle';
    toggle.innerHTML = `<span>${title}</span>${CHEVRON}`;
    toggle.addEventListener('click', () => {
      card.classList.toggle('is-collapsed');
      if (card.classList.contains('is-collapsed')) this.collapsed.add(id);
      else this.collapsed.delete(id);
      this._saveCollapsed();
    });

    const body = document.createElement('div');
    body.className = 'card__body';
    for (const field of fields) {
      const node = this._field(field);
      if (node) body.appendChild(node);
    }

    card.append(toggle, body);
    return card;
  }

  /** Lists frontmatter keys the form has no control for, so nothing feels lost. */
  _preservedCard() {
    const known = this.type === 'creator'
      ? [...CREATOR_FIELDS, 'category']
      : KNOWN_FIELDS;
    const extras = this.doc.frontmatter.keys().filter((k) => !known.includes(k));
    const card = document.createElement('section');
    card.className = 'card';

    if (extras.length === 0) {
      card.innerHTML = `<div class="card__body"><p class="helper">
        همه‌ی فیلدهای این فایل در فرم بالا هستند.</p></div>`;
      return card;
    }

    card.innerHTML = `
      <div class="card__body">
        <div class="preserved">
          <strong>${faDigits(extras.length)} فیلد دیگر در این فایل هست</strong> که فرم برایشان
          کنترلی ندارد. دست‌نخورده باقی می‌مانند و موقع ذخیره سرجایشان برمی‌گردند:
          <div style="margin-top:6px">${extras.map((k) => `<code>${k}</code>`).join('، ')}</div>
        </div>
      </div>`;
    return card;
  }

  /* --- individual fields -------------------------------------------------- */

  _field(name) {
    switch (name) {
      case 'roles': return this._roles();
      case 'socials': return this._socials();
      case 'category': return this._select(name, CATEGORIES, true);
      case 'language': return this._select(name, LANGUAGES, false);
      case 'reader':
      case 'premium': return this._switch(name);
      case 'price': return this._price();
      case 'date': return this._date();
      case 'tags': return this._tags();
      case 'summary': return this._textarea(name);
      case 'book_id': return this._bookId();
      case 'slug': return this._slug();
      case 'series': return this._text(name, 'خالی بگذار اگر مستقل است');
      default: return this._text(name);
    }
  }

  /* --- creator fields ----------------------------------------------------- */

  /** Roles are ticked from a list, and anything not on the list can be typed. */
  _roles() {
    const current = Array.isArray(this.doc.frontmatter.get('roles'))
      ? this.doc.frontmatter.get('roles').map(String)
      : [];

    const wrap = document.createElement('div');
    wrap.className = 'field';

    const chips = document.createElement('div');
    chips.className = 'chips';

    const commit = (list) => {
      if (list.length === 0) this.doc.frontmatter.remove('roles');
      else this.doc.frontmatter.set('roles', list);
      this.onChange();
    };

    // Anything already in the file that is not a suggestion still gets a chip.
    const all = [...new Set([...CREATOR_ROLES, ...current])];

    for (const role of all) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = role;
      chip.setAttribute('aria-pressed', String(current.includes(role)));
      chip.addEventListener('click', () => {
        const next = current.includes(role)
          ? current.filter((r) => r !== role)
          : [...current, role];
        commit(next);
        this.render(this.doc);
      });
      chips.appendChild(chip);
    }

    const add = document.createElement('div');
    add.className = 'input-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'control';
    input.placeholder = 'نقش تازه…';

    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'btn';
    addButton.textContent = 'افزودن';

    const addRole = () => {
      const value = input.value.trim();
      if (!value || current.includes(value)) return;
      commit([...current, value]);
      this.render(this.doc);
    };
    addButton.addEventListener('click', addRole);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); addRole(); }
    });

    add.append(input, addButton);

    const label = document.createElement('label');
    label.textContent = LABELS.roles;

    const hint = document.createElement('div');
    hint.className = 'field__hint';
    hint.textContent = 'زیر نام پدیدآورنده نشان داده می‌شوند.';

    wrap.append(label, chips, add, hint);
    return wrap;
  }

  /** One row per network. An empty row simply is not written to the file. */
  _socials() {
    const current = this.doc.frontmatter.getMap('socials');

    const wrap = document.createElement('div');
    wrap.className = 'field';

    const label = document.createElement('label');
    label.textContent = LABELS.socials;
    wrap.appendChild(label);

    // Every known network, plus any key already in the file that we do not know.
    const keys = [...new Set([...Object.keys(SOCIAL_NETWORKS), ...Object.keys(current)])];

    for (const key of keys) {
      const meta = SOCIAL_NETWORKS[key] || { label: key, placeholder: '' };

      const row = document.createElement('div');
      row.className = 'social-row';

      const name = document.createElement('span');
      name.className = 'social-row__name';
      name.textContent = meta.label;

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'control control--ltr';
      input.placeholder = meta.placeholder;
      input.value = current[key] || '';
      input.addEventListener('input', () => {
        const values = { ...this.doc.frontmatter.getMap('socials') };
        const text = input.value.trim();
        if (text) values[key] = text; else delete values[key];
        this.doc.frontmatter.setMap('socials', values);
        this.onChange();
      });

      row.append(name, input);
      wrap.appendChild(row);
    }

    const hint = document.createElement('div');
    hint.className = 'field__hint';
    hint.textContent = 'خالی‌ها اصلاً در فایل نوشته نمی‌شوند.';
    wrap.appendChild(hint);

    return wrap;
  }

  _wrap(name, control, hint) {
    const field = document.createElement('div');
    field.className = 'field';
    const label = document.createElement('label');
    label.textContent = LABELS[name] || name;
    label.htmlFor = `fm-${name}`;
    field.append(label, control);
    if (hint) {
      const help = document.createElement('div');
      help.className = 'field__hint';
      help.textContent = hint;
      field.appendChild(help);
    }
    return field;
  }

  _text(name, placeholder = '') {
    const input = document.createElement('input');
    input.type = 'text';
    input.id = `fm-${name}`;
    input.className = 'control';
    input.placeholder = placeholder;
    input.value = this._valueOf(name);
    if (['cover', 'image'].includes(name)) input.classList.add('control--ltr');
    input.addEventListener('input', () => this._set(name, input.value.trim() || null));
    return this._wrap(name, input);
  }

  _slug() {
    const row = document.createElement('div');
    row.className = 'input-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'fm-slug';
    input.className = 'control control--ltr';
    input.placeholder = 'book-dedications';
    input.value = this._valueOf('slug');
    input.addEventListener('input', () => this._set('slug', input.value.trim()));

    const suggest = document.createElement('button');
    suggest.type = 'button';
    suggest.className = 'btn';
    suggest.textContent = 'پیشنهاد';
    suggest.addEventListener('click', () => {
      input.value = suggestSlug(this.doc.frontmatter.get('title'));
      this._set('slug', input.value);
    });

    row.append(input, suggest);
    return this._wrap('slug', row, 'نام فایل روی دیسک و آدرس صفحه از همین ساخته می‌شود.');
  }

  _select(name, options, warnLegacy) {
    const select = document.createElement('select');
    select.id = `fm-${name}`;
    select.className = 'control';

    const current = String(this._valueOf(name));
    const known = Object.keys(options);

    // A value the site no longer uses still has to be shown, not swallowed.
    if (current && !known.includes(current)) {
      const stray = document.createElement('option');
      stray.value = current;
      stray.textContent = `${current} (قدیمی)`;
      select.appendChild(stray);
    }

    for (const [value, label] of Object.entries(options)) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = `${label} — ${value}`;
      select.appendChild(option);
    }

    select.value = current || known[0];
    select.addEventListener('change', () => this._set(name, select.value));

    let hint;
    if (warnLegacy && LEGACY_CATEGORIES[current]) {
      hint = `این دسته قدیمی است. build.py خودش به ${LEGACY_CATEGORIES[current]} ترجمه‌اش می‌کند، ولی بهتر است همین‌جا عوضش کنی.`;
    }
    return this._wrap(name, select, hint);
  }

  _switch(name) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'switch';
    button.id = `fm-${name}`;

    const on = this._valueOf(name) === true || this._valueOf(name) === 'true';
    button.setAttribute('aria-checked', String(on));
    button.setAttribute('role', 'switch');
    button.innerHTML = `<span class="switch__label">${LABELS[name]}</span><span class="switch__track"></span>`;

    button.addEventListener('click', () => {
      const next = button.getAttribute('aria-checked') !== 'true';
      button.setAttribute('aria-checked', String(next));
      this._set(name, next);
      // Turning premium on reveals price, so the card is redrawn.
      if (name === 'premium') this.render(this.doc);
    });

    const field = document.createElement('div');
    field.appendChild(button);
    return field;
  }

  _price() {
    const isPremium = this._valueOf('premium') === true;
    if (!isPremium && !this.doc.frontmatter.has('price')) return null;

    const input = document.createElement('input');
    input.type = 'number';
    input.id = 'fm-price';
    input.className = 'control control--ltr';
    input.min = '0';
    input.step = '1000';
    input.value = this._valueOf('price') || '';
    input.addEventListener('input', () => {
      const value = parseInt(input.value, 10);
      this._set('price', Number.isFinite(value) ? value : 0);
    });

    return this._wrap('price', input, 'همین عدد به سوپابیس می‌رود.');
  }

  _date() {
    const raw = enDigits(String(this._valueOf('date') || ''));
    const parts = raw.split('-');
    const year = parts[0] || '1405';
    const month = parts[1] || '01';
    const day = parts[2] || '01';

    const row = document.createElement('div');
    row.className = 'row-3';

    const ySelect = document.createElement('select');
    ySelect.className = 'control';
    for (let y = 1397; y <= 1420; y++) {
      const option = document.createElement('option');
      option.value = String(y);
      option.textContent = faDigits(y);
      ySelect.appendChild(option);
    }
    ySelect.value = year;

    const mSelect = document.createElement('select');
    mSelect.className = 'control';
    PERSIAN_MONTHS.forEach((label, index) => {
      const option = document.createElement('option');
      option.value = String(index + 1).padStart(2, '0');
      option.textContent = label;
      mSelect.appendChild(option);
    });
    mSelect.value = month.padStart(2, '0');

    const dSelect = document.createElement('select');
    dSelect.className = 'control';
    for (let d = 1; d <= 31; d++) {
      const option = document.createElement('option');
      option.value = String(d).padStart(2, '0');
      option.textContent = faDigits(d);
      dSelect.appendChild(option);
    }
    dSelect.value = day.padStart(2, '0');

    const commit = () => this._set('date', `${ySelect.value}-${mSelect.value}-${dSelect.value}`);
    [ySelect, mSelect, dSelect].forEach((el) => el.addEventListener('change', commit));

    row.append(ySelect, mSelect, dSelect);
    return this._wrap('date', row, 'تاریخ شمسی، همان قالبی که build.py می‌خواند.');
  }

  _tags() {
    const value = this._valueOf('tags');
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'fm-tags';
    input.className = 'control';
    input.placeholder = 'کتاب، کتابخوانی، مجله‌ی اسب';
    input.value = Array.isArray(value) ? value.join('، ') : String(value || '');
    input.addEventListener('input', () => {
      const list = input.value.replace(/،/g, ',').split(',').map((t) => t.trim()).filter(Boolean);
      this._set('tags', list);
    });
    return this._wrap('tags', input, 'با ویرگول جدا کن. هر هشتگ یک صفحه‌ی آرشیو می‌سازد.');
  }

  _textarea(name) {
    const area = document.createElement('textarea');
    area.id = `fm-${name}`;
    area.className = 'control';
    area.rows = 3;
    area.placeholder = 'اگر خالی بماند، برای آثار رایگان خودکار ساخته می‌شود.';
    area.value = this._valueOf(name);
    area.addEventListener('input', () => this._set(name, area.value.trim() || null));
    return this._wrap(name, area);
  }

  _bookId() {
    const row = document.createElement('div');
    row.className = 'input-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'fm-book_id';
    input.className = 'control control--ltr';
    input.readOnly = true;
    input.value = this._valueOf('book_id');

    const make = document.createElement('button');
    make.type = 'button';
    make.className = 'btn';
    make.textContent = input.value ? 'تازه' : 'ساختن';
    make.addEventListener('click', () => {
      input.value = newBookId();
      this._set('book_id', input.value);
      make.textContent = 'تازه';
    });

    row.append(input, make);
    return this._wrap('book_id', row,
      'برای هر اثر یکتاست و هیچ‌وقت نباید بین دو اثر مشترک شود.');
  }

  /* --- plumbing ----------------------------------------------------------- */

  _valueOf(name) {
    const value = this.doc.frontmatter.get(name);
    return value === undefined || value === null ? '' : value;
  }

  _set(name, value) {
    if (value === null || value === '') this.doc.frontmatter.remove(name);
    else this.doc.frontmatter.set(name, value);
    this.onChange();
  }

  _loadCollapsed() {
    try {
      const raw = localStorage.getItem('asb-studio:cards');
      return new Set(raw ? JSON.parse(raw) : ['system', 'media']);
    } catch {
      return new Set(['system', 'media']);
    }
  }

  _saveCollapsed() {
    try {
      localStorage.setItem('asb-studio:cards', JSON.stringify([...this.collapsed]));
    } catch { /* private mode */ }
  }
}
