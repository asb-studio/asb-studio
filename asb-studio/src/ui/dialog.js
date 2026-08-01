/* ==========================================================================
   ui/dialog.js
   --------------------------------------------------------------------------
   Every question the studio asks, asked properly.

   The browser's own prompt(), confirm() and alert() freeze the page, cannot
   be styled, cannot be laid out right to left, and look like a system error
   even when they are saying something friendly. The original brief said no
   prompt() dialogs, and this is where that promise is kept.

   Each function returns a Promise. Nothing blocks; the caller simply awaits.
   ========================================================================== */

let open = null;

/* --------------------------------------------------------------------------
   Shell
   -------------------------------------------------------------------------- */

function shell({ title, body, actions, wide = false }) {
  return new Promise((resolve) => {
    close();

    const overlay = document.createElement('div');
    overlay.className = 'overlay';

    const card = document.createElement('div');
    card.className = 'dialog' + (wide ? ' dialog--wide' : '');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');

    const head = document.createElement('header');
    head.className = 'dialog__head';
    head.innerHTML = `<h2>${title}</h2>`;

    const content = document.createElement('div');
    content.className = 'dialog__body';
    if (typeof body === 'string') content.innerHTML = body;
    else content.appendChild(body);

    const foot = document.createElement('footer');
    foot.className = 'dialog__actions';

    const finish = (value) => { close(); resolve(value); };

    for (const action of actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn ' + (action.primary ? 'btn--primary' : action.danger ? 'btn--danger' : 'btn--outline');
      button.textContent = action.label;
      button.addEventListener('click', () => finish(action.value));
      foot.appendChild(button);
    }

    card.append(head, content, foot);
    overlay.appendChild(card);

    // Escape and a click on the backdrop both mean "the least committal option".
    const cancelValue = (actions.find((a) => a.cancel) || { value: null }).value;
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) finish(cancelValue);
    });
    const onKey = (event) => {
      if (event.key === 'Escape') { event.stopPropagation(); finish(cancelValue); }
      if (event.key === 'Enter' && event.target.tagName !== 'TEXTAREA') {
        const primary = actions.find((a) => a.primary);
        if (primary) { event.preventDefault(); finish(primary.value); }
      }
    };
    overlay.addEventListener('keydown', onKey);

    document.body.appendChild(overlay);
    open = overlay;

    const first = card.querySelector('input, textarea, select, .btn--primary');
    if (first) first.focus();
  });
}

export function close() {
  if (open) { open.remove(); open = null; }
}

export function isOpen() {
  return Boolean(open);
}

/* --------------------------------------------------------------------------
   The everyday three
   -------------------------------------------------------------------------- */

/** A statement with one way out. */
export function say(title, message) {
  return shell({
    title,
    body: `<p class="dialog__text">${message}</p>`,
    actions: [{ label: 'باشد', value: true, primary: true, cancel: true }],
  });
}

/**
 * A yes or no question. `danger` marks the confirming button as destructive.
 * @returns {Promise<boolean>}
 */
export function ask(title, message, { confirmLabel = 'ادامه', cancelLabel = 'انصراف', danger = false } = {}) {
  return shell({
    title,
    body: `<p class="dialog__text">${message}</p>`,
    actions: [
      { label: cancelLabel, value: false, cancel: true },
      { label: confirmLabel, value: true, primary: !danger, danger },
    ],
  });
}

/**
 * Asks for one or more values.
 * @param {Array} fields  [{ name, label, value, placeholder, type, hint, options }]
 * @returns {Promise<object|null>} the filled values, or null on cancel
 */
export function form(title, fields, { confirmLabel = 'تأیید' } = {}) {
  const wrap = document.createElement('div');

  for (const field of fields) {
    const block = document.createElement('div');
    block.className = 'field';

    const label = document.createElement('label');
    label.textContent = field.label;
    label.htmlFor = `dlg-${field.name}`;
    block.appendChild(label);

    let control;
    if (field.type === 'select') {
      control = document.createElement('select');
      for (const [value, text] of Object.entries(field.options || {})) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        control.appendChild(option);
      }
    } else {
      control = document.createElement('input');
      control.type = field.type || 'text';
      control.placeholder = field.placeholder || '';
      if (field.min !== undefined) control.min = field.min;
    }

    control.id = `dlg-${field.name}`;
    control.className = 'control' + (field.ltr ? ' control--ltr' : '');
    control.name = field.name;
    control.value = field.value === undefined || field.value === null ? '' : field.value;
    block.appendChild(control);

    if (field.hint) {
      const hint = document.createElement('div');
      hint.className = 'field__hint';
      hint.textContent = field.hint;
      block.appendChild(hint);
    }

    wrap.appendChild(block);
  }

  return shell({
    title,
    body: wrap,
    actions: [
      { label: 'انصراف', value: null, cancel: true },
      { label: confirmLabel, value: 'ok', primary: true },
    ],
  }).then((result) => {
    if (result !== 'ok') return null;
    const values = {};
    for (const field of fields) {
      const control = wrap.querySelector(`#dlg-${field.name}`);
      values[field.name] = control ? control.value : '';
    }
    return values;
  });
}

/**
 * A card with arbitrary content and custom buttons. Used where a sentence is
 * not enough - the restore card, the repair report.
 */
export function custom(title, node, actions, options = {}) {
  return shell({ title, body: node, actions, ...options });
}
