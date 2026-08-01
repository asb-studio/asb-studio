/* ==========================================================================
   ui/toolbar.js
   --------------------------------------------------------------------------
   The toolbar: the frequent commands as icons, in one compact row.

   Everything here is also in the menu bar, so nothing is ever lost when the
   row runs out of room - what does not fit moves into a ⋮ button rather than
   disappearing past the edge of a narrow screen. That was the whole failure
   on a 1280-wide monitor: the tools were still there, just unreachable.

   Widths are measured after layout, so the overflow point is whatever the
   window actually allows, not a guess baked into a media query.
   ========================================================================== */

import { COMMANDS, GROUPS, iconSvg } from '../commands/registry.js';
import { loadTools } from './toolbar-config.js';

export class Toolbar {
  constructor(root, ctx) {
    this.root = root;
    this.ctx = ctx;
    this.items = [];
    this._build();
    this._watch();
  }

  _build() {
    this.root.innerHTML = '';
    this.items = [];

    const track = document.createElement('div');
    track.className = 'toolbar__track';

    // Which tools, and in which cluster, both come from the author's own
    // choice - see ui/toolbar-config.js. Commands with no cluster of their
    // own are gathered at the end.
    const wanted = new Set(loadTools());
    const clusters = [...GROUPS, 'extra'];

    for (const groupId of clusters) {
      const commands = COMMANDS.filter((c) =>
        wanted.has(c.id) && (groupId === 'extra' ? !c.group : c.group === groupId));
      if (commands.length === 0) continue;

      const group = document.createElement('div');
      group.className = 'toolbar__group';
      for (const command of commands) group.appendChild(this._button(command));

      track.appendChild(group);
      this.items.push(group);
    }

    /* --- overflow --- */
    const more = document.createElement('div');
    more.className = 'toolbar__more';
    more.hidden = true;

    const moreButton = document.createElement('button');
    moreButton.type = 'button';
    moreButton.className = 'btn btn--icon';
    moreButton.setAttribute('aria-label', 'ابزارهای بیشتر');
    moreButton.dataset.tip = 'ابزارهای بیشتر';
    moreButton.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round"><circle cx="12" cy="5" r="1"/>
      <circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>`;

    const morePanel = document.createElement('div');
    morePanel.className = 'toolbar__overflow';
    morePanel.hidden = true;

    moreButton.addEventListener('click', (event) => {
      event.stopPropagation();
      morePanel.hidden = !morePanel.hidden;
    });
    document.addEventListener('click', () => { morePanel.hidden = true; });

    more.append(moreButton, morePanel);

    this.root.append(track, more);
    this.track = track;
    this.more = more;
    this.morePanel = morePanel;
  }

  _button(command) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn--icon';
    button.dataset.command = command.id;
    button.dataset.tip = command.tip || command.label || command.id;
    button.setAttribute('aria-label', command.tip || command.label || command.id);

    if (command.textIcon) {
      button.textContent = command.textIcon;
      button.classList.add('btn--text-icon');
    } else {
      button.innerHTML = iconSvg(command.icon);
    }

    // mousedown, not click: the editor must not lose its selection first.
    button.addEventListener('mousedown', (event) => {
      event.preventDefault();
      command.run(this.ctx);
    });
    button.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        command.run(this.ctx);
      }
    });

    return button;
  }

  /* --------------------------------------------------------------------------
     Overflow
     Groups are hidden from the end until the row fits, and the hidden ones are
     rebuilt inside the ⋮ panel. Measuring beats guessing: the same window width
     holds a different number of tools depending on the font that loaded.
     -------------------------------------------------------------------------- */
  _reflow() {
    // Start from everything visible so the measurement is honest.
    for (const group of this.items) group.hidden = false;
    this.more.hidden = true;

    const available = this.root.clientWidth - 46;   // room for the ⋮ button
    let used = 0;
    const hidden = [];

    for (const group of this.items) {
      used += group.offsetWidth;
      if (used > available) hidden.push(group);
    }

    if (hidden.length === 0) { this.morePanel.innerHTML = ''; return; }

    for (const group of hidden) group.hidden = true;
    this.more.hidden = false;

    this.morePanel.innerHTML = '';
    for (const group of hidden) {
      const ids = [...group.querySelectorAll('[data-command]')].map((b) => b.dataset.command);
      for (const id of ids) {
        const command = COMMANDS.find((c) => c.id === id);
        if (!command) continue;

        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'toolbar__overflow-item';
        row.innerHTML = `<span class="menu__icon">${command.icon ? iconSvg(command.icon) : (command.textIcon || '')}</span>`;
        row.appendChild(document.createTextNode(command.label || command.id));
        row.addEventListener('mousedown', (event) => {
          event.preventDefault();
          this.morePanel.hidden = true;
          command.run(this.ctx);
        });
        this.morePanel.appendChild(row);
      }
    }
  }

  /** Rebuilds after the author changes which tools are on the bar. */
  refresh() {
    this._build();
    this._watch();
  }

  _watch() {
    // Fonts and themes change widths after first paint, so measure again on
    // every resize rather than once at boot.
    const reflow = () => requestAnimationFrame(() => this._reflow());
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(reflow).observe(this.root);
    } else {
      window.addEventListener('resize', reflow);
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(reflow);
    reflow();
  }
}

/** Binds the shortcuts declared in the registry. */
export function bindShortcuts(ctx) {
  const bindings = COMMANDS.filter((c) => c.key).map((c) => {
    const parts = c.key.split('-');
    return {
      command: c,
      key: parts[parts.length - 1].toLowerCase(),
      shift: parts.includes('Shift'),
      alt: parts.includes('Alt'),
    };
  });

  window.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;

    const hit = bindings.find((b) =>
      event.key.toLowerCase() === b.key &&
      Boolean(event.shiftKey) === b.shift &&
      Boolean(event.altKey) === b.alt);

    if (!hit) return;
    event.preventDefault();
    hit.command.run(ctx);
  });
}
