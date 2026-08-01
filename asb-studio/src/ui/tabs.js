/* ==========================================================================
   ui/tabs.js
   --------------------------------------------------------------------------
   The tab strip.

   It renders whatever the session holds and reports clicks back. It owns no
   state of its own - if the strip and the session ever disagreed, the strip
   would be the one lying.
   ========================================================================== */

export class Tabs {
  /**
   * @param {HTMLElement} root  the strip element
   * @param {object} handlers  { onSelect(id), onClose(id), onNew() }
   */
  constructor(root, handlers) {
    this.root = root;
    this.handlers = handlers;
  }

  render(session) {
    this.root.innerHTML = '';

    for (const tab of session.tabs) {
      this.root.appendChild(this._tab(tab, tab.id === session.activeId));
    }

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'tab-add';
    add.dataset.tip = 'سند تازه';
    add.setAttribute('aria-label', 'سند تازه');
    add.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`;
    add.addEventListener('click', () => this.handlers.onNew());
    this.root.appendChild(add);
  }

  _tab(tab, active) {
    const el = document.createElement('div');
    el.className = 'tab' + (active ? ' is-active' : '');
    el.dataset.tip = tab.name;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tab__name';
    button.textContent = tab.name;
    button.setAttribute('aria-current', String(active));
    button.addEventListener('click', () => this.handlers.onSelect(tab.id));

    const dot = document.createElement('span');
    dot.className = 'tab__dot';
    dot.hidden = !tab.dirty;
    dot.setAttribute('aria-label', 'ذخیره نشده');

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'tab__close';
    close.setAttribute('aria-label', `بستن ${tab.name}`);
    close.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`;
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      this.handlers.onClose(tab.id);
    });

    // Middle click closes, the way every editor with tabs behaves.
    el.addEventListener('auxclick', (event) => {
      if (event.button === 1) { event.preventDefault(); this.handlers.onClose(tab.id); }
    });

    el.append(button, dot, close);
    return el;
  }
}
