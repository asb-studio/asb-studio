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
import { place, follow } from './popover.js';

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

    const closeOverflow = () => {
      morePanel.hidden = true;
      if (this._unfollow) { this._unfollow(); this._unfollow = null; }
    };

    moreButton.addEventListener('click', (event) => {
      event.stopPropagation();
      if (!morePanel.hidden) { closeOverflow(); return; }

      morePanel.hidden = false;
      // The toolbar needs overflow:hidden to measure itself, and that same
      // rule was cutting this panel off at the bar's edge - so it is placed
      // against the window instead. See ui/popover.js.
      morePanel.dataset.align = 'end';
      place(morePanel, moreButton, 'end');
      this._unfollow = follow(morePanel, moreButton, closeOverflow);
    });

    document.addEventListener('click', closeOverflow);
    this._closeOverflow = closeOverflow;

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

    if (hidden.length === 0) {
      this.morePanel.innerHTML = '';
      if (this._closeOverflow) this._closeOverflow();
      return;
    }

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
          if (this._closeOverflow) this._closeOverflow();
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

/* --------------------------------------------------------------------------
   Shortcuts

   Split in two on purpose:

   editorShortcuts()  bindings that act on the text. They are handed to
                      CodeMirror and placed ahead of its own keymap, so they
                      beat defaultKeymap - which claims Mod-i for
                      selectParentSyntax and was quietly expanding the
                      selection to the whole paragraph before the italics went
                      on. CodeMirror also matches the US base layout, so these
                      work with a Persian keyboard switched on.

   bindAppShortcuts() the rest - opening, saving, panels. These are window
                      level because they must work wherever the focus is, and
                      they are matched on event.code for the same layout
                      reason.
   -------------------------------------------------------------------------- */

/* Which keys belong to the editor rather than the application. */
const EDITOR_KEYS = new Set(['Mod-b', 'Mod-i', 'Mod-k', 'Mod-f']);

/** CodeMirror bindings, built from the registry. */
export function editorShortcuts(ctx) {
  return COMMANDS
    .filter((c) => c.key && EDITOR_KEYS.has(c.key))
    .map((c) => ({
      key: c.key,
      preventDefault: true,
      run: () => { c.run(ctx); return true; },
    }));
}

/* event.key is the letter the layout produces - 'ذ' on a Persian keyboard, not
   'b'. event.code is the physical key and never changes, which is why the
   shortcuts stopped working the moment the keyboard was switched. */
const CODE_FOR = {
  b: 'KeyB', i: 'KeyI', k: 'KeyK', o: 'KeyO', s: 'KeyS',
  n: 'KeyN', f: 'KeyF', p: 'KeyP', r: 'KeyR', w: 'KeyW', e: 'KeyE',
};

/** Window-level bindings for everything that is not text editing. */
export function bindAppShortcuts(ctx) {
  const bindings = COMMANDS
    .filter((c) => c.key && !EDITOR_KEYS.has(c.key))
    .map((c) => {
      const parts = c.key.split('-');
      const letter = parts[parts.length - 1].toLowerCase();
      return {
        command: c,
        code: CODE_FOR[letter] || null,
        key: letter,
        shift: parts.includes('Shift'),
        alt: parts.includes('Alt'),
      };
    });

  window.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;

    const hit = bindings.find((b) => {
      const matches = b.code
        ? event.code === b.code
        : event.key.toLowerCase() === b.key;
      return matches
        && Boolean(event.shiftKey) === b.shift
        && Boolean(event.altKey) === b.alt;
    });

    if (!hit) return;
    event.preventDefault();
    hit.command.run(ctx);
  });
}
