/* ==========================================================================
   model/session.js
   --------------------------------------------------------------------------
   The set of documents that are open at once.

   Until now the studio held exactly one document in a handful of variables.
   Tabs mean that state has to become a list, and the moment it is a list it
   needs an owner - otherwise "which document is this?" gets answered slightly
   differently in five places.

   A tab owns: the parsed document, where it came from on disk, whether it has
   unsaved changes, and where the caret was left. Everything the editor needs
   to put a document back exactly as its author left it.

   This module must never touch the DOM.
   ========================================================================== */

import { parseDocument, AsbDocument } from './document.js';

let counter = 0;

export class Tab {
  constructor({ name, doc, handle = null }) {
    this.id = `tab-${++counter}`;
    this.name = name;
    this.doc = doc;
    this.handle = handle;
    this.dirty = false;
    this.caret = 0;      // character offset, restored on return
    this.scroll = 0;     // preview scroll position

    /* --- shared workspace -----------------------------------------------
       A tab is either local (a file handle) or shared (a workspace path).
       Never both: saving has to know which place it is writing to.        */
    this.remotePath = null;   // path in the workspace, when it came from there
    this.readOnly = false;    // true when somebody else holds the lock
  }

  /** The body as it stands, ready for the editor. */
  get body() { return this.doc.body; }
}

export class Session {
  constructor() {
    this.tabs = [];
    this.activeId = null;
    this.listeners = [];
  }

  onChange(fn) { this.listeners.push(fn); }
  _emit() { this.listeners.forEach((fn) => fn(this)); }

  get active() {
    return this.tabs.find((t) => t.id === this.activeId) || null;
  }

  get count() { return this.tabs.length; }

  get hasUnsaved() { return this.tabs.some((t) => t.dirty); }

  /** Opens a parsed document as a new tab and makes it active. */
  open(name, text, handle = null) {
    const tab = new Tab({ name, doc: parseDocument(text), handle });
    this.tabs.push(tab);
    this.activeId = tab.id;
    this._emit();
    return tab;
  }

  /** Opens an empty untitled document. */
  openBlank(name = 'بدون‌نام.md') {
    const tab = new Tab({ name, doc: new AsbDocument() });
    this.tabs.push(tab);
    this.activeId = tab.id;
    this._emit();
    return tab;
  }

  /**
   * If this file is already open, focuses that tab instead of opening a
   * second copy of it. Two tabs onto one file is how edits get lost.
   */
  findByName(name) {
    return this.tabs.find((t) => t.name === name) || null;
  }

  setActive(id) {
    if (!this.tabs.some((t) => t.id === id)) return;
    this.activeId = id;
    this._emit();
  }

  /** Closes a tab and hands focus to its neighbour. */
  close(id) {
    const index = this.tabs.findIndex((t) => t.id === id);
    if (index === -1) return;

    this.tabs.splice(index, 1);

    if (this.activeId === id) {
      const next = this.tabs[index] || this.tabs[index - 1] || null;
      this.activeId = next ? next.id : null;
    }
    this._emit();
  }

  /** Serialises every open tab, for crash recovery. */
  snapshot() {
    return this.tabs.map((tab) => ({
      name: tab.name,
      text: tab.doc.serialize(),
      dirty: tab.dirty,
      active: tab.id === this.activeId,
    }));
  }

  /** Rebuilds a session from a snapshot. File handles cannot survive a
      reload, so restored tabs save through the picker the first time. */
  restore(snapshot) {
    this.tabs = [];
    this.activeId = null;

    for (const entry of snapshot) {
      const tab = new Tab({ name: entry.name, doc: parseDocument(entry.text) });
      tab.dirty = Boolean(entry.dirty);
      this.tabs.push(tab);
      if (entry.active) this.activeId = tab.id;
    }

    if (!this.activeId && this.tabs.length) this.activeId = this.tabs[0].id;
    this._emit();
  }

  touch() { this._emit(); }
}
