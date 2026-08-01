/* ==========================================================================
   ui/menubar.js
   --------------------------------------------------------------------------
   The menu bar.

   It exists for one reason: a toolbar can run out of room, and a menu cannot.
   Thirty tools in a single row fit a wide monitor and quietly lose their last
   third on a narrow one, with nothing to tell the writer what went missing.
   Every command lives here, at every window width, forever.

   Built entirely from commands/registry.js. No editing logic of its own.
   ========================================================================== */

import { MENUS, commandsInMenu, iconSvg } from '../commands/registry.js';

const KEY_LABELS = {
  'Mod-b': 'Ctrl+B', 'Mod-i': 'Ctrl+I', 'Mod-k': 'Ctrl+K',
  'Mod-o': 'Ctrl+O', 'Mod-s': 'Ctrl+S', 'Mod-Shift-s': 'Ctrl+Shift+S',
  'Mod-Alt-n': 'Ctrl+Alt+N',
};

export class MenuBar {
  /**
   * @param {HTMLElement} root  the <nav class="menubar">
   * @param {object} ctx  the command context
   */
  constructor(root, ctx) {
    this.root = root;
    this.ctx = ctx;
    this.open = null;
    this._byId = new Map();
    this._build();
    this._bindGlobal();
  }

  _build() {
    this.root.innerHTML = '';

    for (const menu of MENUS) {
      const commands = commandsInMenu(menu.id);
      if (commands.length === 0) continue;

      const wrap = document.createElement('div');
      wrap.className = 'menu';

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'menu__button';
      button.textContent = menu.label;
      button.setAttribute('aria-haspopup', 'true');
      button.setAttribute('aria-expanded', 'false');

      const list = document.createElement('div');
      list.className = 'menu__list';
      list.setAttribute('role', 'menu');
      list.hidden = true;

      for (const command of commands) {
        if (command.separatorBefore) {
          const rule = document.createElement('div');
          rule.className = 'menu__sep';
          list.appendChild(rule);
        }
        this._byId.set(command.id, command);
        list.appendChild(this._item(command));
      }

      button.addEventListener('click', (event) => {
        event.stopPropagation();
        if (this.open === wrap) this.closeAll();
        else this._openMenu(wrap);
      });

      // Once one menu is open, sliding across the bar switches between them -
      // the behaviour every menu bar has had for forty years.
      button.addEventListener('mouseenter', () => {
        if (this.open && this.open !== wrap) this._openMenu(wrap);
      });

      wrap.append(button, list);
      this.root.appendChild(wrap);
    }
  }

  _item(command) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'menu__item';
    item.setAttribute('role', 'menuitem');

    const icon = document.createElement('span');
    icon.className = 'menu__icon';
    icon.innerHTML = command.icon ? iconSvg(command.icon) : '';

    // A command that reports its own state shows a tick instead of an icon,
    // and the state is read when the menu opens, not when it was built.
    if (command.checked) {
      item.dataset.checkable = 'true';
      item.setAttribute('role', 'menuitemradio');
    }

    const label = document.createElement('span');
    label.className = 'menu__label';
    label.textContent = command.label || command.id;

    const key = document.createElement('span');
    key.className = 'menu__key';
    key.textContent = command.key ? (KEY_LABELS[command.key] || command.key) : '';

    item.dataset.command = command.id;
    item.append(icon, label, key);
    item.addEventListener('click', (event) => {
      event.stopPropagation();
      this.closeAll();
      command.run(this.ctx);
    });

    return item;
  }

  /** Refreshes the tick marks. State can change between two openings. */
  _syncChecks(wrap) {
    for (const item of wrap.querySelectorAll('[data-checkable]')) {
      const command = this._commandOf(item);
      if (!command) continue;
      const on = Boolean(command.checked(this.ctx));
      item.setAttribute('aria-checked', String(on));
      item.querySelector('.menu__icon').innerHTML = on ? '✓' : '';
    }
  }

  _commandOf(item) {
    return this._byId.get(item.dataset.command);
  }

  _openMenu(wrap) {
    this.closeAll();
    this._syncChecks(wrap);
    wrap.classList.add('is-open');
    wrap.querySelector('.menu__list').hidden = false;
    wrap.querySelector('.menu__button').setAttribute('aria-expanded', 'true');
    this.open = wrap;
  }

  closeAll() {
    for (const wrap of this.root.querySelectorAll('.menu')) {
      wrap.classList.remove('is-open');
      wrap.querySelector('.menu__list').hidden = true;
      wrap.querySelector('.menu__button').setAttribute('aria-expanded', 'false');
    }
    this.open = null;
  }

  _bindGlobal() {
    document.addEventListener('click', () => this.closeAll());
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.open) {
        event.stopPropagation();
        this.closeAll();
      }
    }, true);
  }
}
