/* ==========================================================================
   editor/editor.js
   --------------------------------------------------------------------------
   Wraps CodeMirror 6 into the one thing the rest of the app needs: a text
   buffer holding the Markdown body.

   Why CodeMirror rather than a contenteditable surface: undo/redo, find and
   replace, multi-cursor and above all bidirectional text are already solved
   here. Persian prose interleaved with Latin Markdown punctuation is the
   hardest case a text editor faces, and it is the case this project lives in
   every day.

   Everything outside this file talks through the public methods below and
   never reaches into CodeMirror internals, so the editing engine stays
   replaceable without touching anything else.
   ========================================================================== */

import {
  EditorState, EditorSelection, EditorView, keymap, history, historyKeymap, defaultKeymap,
  indentWithTab, markdown, markdownLanguage, syntaxHighlighting, HighlightStyle,
  tags, search, searchKeymap, openSearchPanel, moveLineUp, moveLineDown,
  drawSelection, highlightActiveLine, highlightTrailingWhitespace, undo, redo,
} from '../../vendor/codemirror.js';

/* --------------------------------------------------------------------------
   Syntax colours
   Deliberately quiet. Markdown punctuation is dimmed rather than coloured so
   the Persian prose stays the loudest thing on the screen. Every value is a
   CSS variable, which is what makes the light and dark themes free.
   -------------------------------------------------------------------------- */
const asbHighlight = HighlightStyle.define([
  /* Prose stays the colour of prose. Only two things earn a colour: a heading,
     because it is structure, and the two structural comments, because missing
     one of those changes what gets published.

     Everything else is shape rather than hue - bold reads as bold, a quote
     reads as a quote, and the punctuation that makes them is simply dimmed.
     The earlier palette lit up links, code, list bullets and rules as well,
     which on the dark themes turned a page of Persian prose into confetti. */
  { tag: tags.heading, color: 'var(--accent-strong)', fontWeight: '700' },
  { tag: tags.strong, fontWeight: '700', color: 'var(--fg)' },
  { tag: tags.emphasis, fontStyle: 'italic', color: 'var(--fg)' },
  { tag: tags.strikethrough, textDecoration: 'line-through', color: 'var(--fg-dim)' },
  { tag: tags.link, color: 'var(--fg)' },
  { tag: tags.url, color: 'var(--fg-faint)' },
  { tag: tags.quote, color: 'var(--fg-dim)', fontStyle: 'italic' },
  { tag: tags.monospace, color: 'var(--fg-dim)' },
  { tag: tags.processingInstruction, color: 'var(--fg-faint)' },
  { tag: tags.contentSeparator, color: 'var(--fg-faint)' },
  { tag: tags.list, color: 'var(--fg-faint)' },
  { tag: tags.comment, color: 'var(--accent-strong)', fontWeight: '600' },
]);

const asbTheme = EditorView.theme({
  '&': { height: '100%', fontSize: 'var(--editor-size)', color: 'var(--fg)', background: 'transparent' },
  '.cm-scroller': {
    fontFamily: 'var(--font-ui)',
    lineHeight: 'var(--editor-leading)',
    padding: '30px 34px 40vh',
    direction: 'rtl',
  },
  '.cm-content': { caretColor: 'var(--accent)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-activeLine': { background: 'var(--line-active)' },
  /* --- selection ---------------------------------------------------------
     THE SELECTOR HERE HAS TO BE THIS LONG, and that is the whole story.

     With drawSelection() the native selection is hidden and CodeMirror paints
     its own layer, styled from its base theme by:

         .cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground

     Four classes and two child combinators. A shorter rule of ours - however
     late it is loaded - loses on specificity, not on order. So the lilac
     #d7d4f0 that ships with the library kept winning inside the editor while
     our grey applied perfectly well in the preview pane, which uses the
     ordinary ::selection. Same variable, two different outcomes, and no
     obvious reason why.

     Matched selector plus !important, because there is no way to be more
     specific than the library without getting silly. */
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
    background: 'var(--selection) !important',
  },
  '.cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground': {
    background: 'var(--selection) !important',
  },
  '.cm-content ::selection, ::selection': { background: 'var(--selection)' },

  /* Belt and braces: if any extension ever paints matches again, it inherits
     something quiet rather than the library default. */
  '.cm-selectionMatch': { background: 'var(--selection-match)' },
  /* The caret layer is styled by an equally long selector in the base theme,
     so it needs the same treatment. */
  '&.cm-focused > .cm-scroller > .cm-cursorLayer .cm-cursor': {
    borderLeftColor: 'var(--accent) !important',
    borderLeftWidth: '2px',
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '.cm-panels': {
    background: 'var(--panel)', color: 'var(--fg)', direction: 'ltr',
    fontFamily: 'var(--font-ui)', fontSize: '0.82rem',
    borderBottom: '1px solid var(--line)',
  },
  '.cm-panel input, .cm-panel button, .cm-panel label': { fontFamily: 'inherit', fontSize: '0.8rem' },
  '.cm-textfield': {
    background: 'var(--paper)', color: 'var(--fg)',
    border: '1px solid var(--line)', borderRadius: '6px', padding: '4px 7px',
  },
  '.cm-button': {
    background: 'var(--panel-2)', color: 'var(--fg)', backgroundImage: 'none',
    border: '1px solid var(--line)', borderRadius: '6px', padding: '4px 10px',
  },
  '.cm-searchMatch': { background: 'var(--match)' },
  '.cm-searchMatch-selected': { background: 'var(--match-active)' },
  /* Two trailing spaces are a real Markdown line break, so they have to be
     visible - but as a hairline under the line, not a block of colour. */
  '.cm-trailingSpace': {
    background: 'none',
    borderBottom: '2px solid var(--trailing-space)',
  },
});

/* --------------------------------------------------------------------------
   Public wrapper
   -------------------------------------------------------------------------- */

export class MarkdownEditor {
  /**
   * @param {HTMLElement} parent  where to mount
   * @param {(text: string) => void} onChange  fired on every document edit
   */
  /**
   * @param {HTMLElement} parent
   * @param {(text: string) => void} onChange
   * @param {Array<{key: string, run: Function}>} shortcuts  editor bindings,
   *   placed AHEAD of CodeMirror's own so they win. See the note below.
   */
  constructor(parent, onChange, shortcuts = []) {
    this.onChange = onChange;
    this._cursorListeners = [];

    const watcher = EditorView.updateListener.of((update) => {
      if (update.docChanged) this.onChange(this.getText());
      if (update.selectionSet || update.docChanged) this._notifyCursor();
    });

    this.view = new EditorView({
      parent,
      state: EditorState.create({
        doc: '',
        extensions: [
          history(),
          drawSelection(),
          highlightActiveLine(),
          // Two trailing spaces are a real Markdown line break but invisible.
          // Showing them stops an editor or a git hook silently eating one.
          highlightTrailingWhitespace(),
          // highlightSelectionMatches() is deliberately NOT here. In code,
          // lighting up every other occurrence of the selected token is
          // useful. In prose it means selecting a common word paints the
          // whole page - and CodeMirror's default colour for it is a violet
          // that belongs to no theme. Ctrl+F is the right tool for finding
          // the other occurrences of a word.
          search({ top: true }),
          markdown({ base: markdownLanguage }),
          syntaxHighlighting(asbHighlight),
          asbTheme,
          EditorView.lineWrapping,
          /* OUR BINDINGS COME FIRST, and that is the whole fix for a bug that
             took a week to surface.

             CodeMirror's defaultKeymap already claims Mod-i for
             selectParentSyntax - it grows the selection out to the enclosing
             syntax node. In Markdown that node is the whole paragraph. So
             pressing Ctrl+I selected the entire block first, and the italics
             then wrapped all of it, attribute line and permanent id included.
             Exactly the "the whole line goes italic" that was reported.

             Within one keymap the earlier binding wins, so listing ours ahead
             of defaultKeymap takes Mod-i back.

             This also fixes the Persian layout. A window-level listener has to
             compare event.key, which on a Persian keyboard is 'ذ' rather than
             'b' - so the shortcuts simply did nothing. CodeMirror matches
             against the US base layout as well as the active one, so the same
             physical key works whichever language is switched on. */
          keymap.of([
            ...shortcuts,

            /* Ctrl+H is the browser's history window unless something claims
               it first, and replace is where an editor expects to find it. */
            { key: 'Mod-h', preventDefault: true,
              run: (view) => { openSearchPanel(view); return true; } },

            /* Moving a line is Alt+Arrow everywhere, but Chrome reads
               Alt+Left/Right as back and forward. Up and down are free, and
               those are the ones this is actually for. */
            { key: 'Alt-ArrowUp', preventDefault: true, run: moveLineUp },
            { key: 'Alt-ArrowDown', preventDefault: true, run: moveLineDown },

            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            indentWithTab,
          ]),
          watcher,
        ],
      }),
    });
  }

  /* --- reading and writing the whole buffer ----------------------------- */

  getText() { return this.view.state.doc.toString(); }

  setText(text) {
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: text },
      selection: { anchor: 0 },
      scrollIntoView: true,
    });
  }

  /** Where the caret is, as a character offset. Saved when a tab is left. */
  getCaret() { return this.view.state.selection.main.head; }

  /** Puts the caret back where a tab was left, clamped to the new document. */
  setCaret(offset) {
    const max = this.view.state.doc.length;
    const at = Math.max(0, Math.min(offset || 0, max));
    this.view.dispatch({
      selection: { anchor: at },
      effects: EditorView.scrollIntoView(at, { y: 'center' }),
    });
  }

  /* --- navigation -------------------------------------------------------- */

  goToLine(lineNumber) {
    const doc = this.view.state.doc;
    const line = doc.line(Math.max(1, Math.min(lineNumber, doc.lines)));
    this.view.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
    });
    this.view.focus();
  }

  /* --- inline editing ----------------------------------------------------- */

  /** Puts the caret at a character offset and scrolls it into view. */
  goToOffset(offset) {
    const max = this.view.state.doc.length;
    const at = Math.max(0, Math.min(offset, max));
    this.view.dispatch({
      selection: { anchor: at },
      effects: EditorView.scrollIntoView(at, { y: 'center' }),
    });
    this.view.focus();
  }

  /** Wraps the selection, or drops the markers at the caret ready to type in. */
  wrapSelection(before, after = before) {
    const { state } = this.view;
    this.view.dispatch(state.changeByRange((range) => ({
      changes: [
        { from: range.from, insert: before },
        { from: range.to, insert: after },
      ],
      // The selection keeps covering the same words, now inside the markers.
      range: EditorSelection.range(range.from + before.length, range.to + before.length),
    })));
    this.view.focus();
  }

  /** Replaces the current selection with arbitrary text. */
  replaceSelection(text) {
    const { state } = this.view;
    this.view.dispatch(state.replaceSelection(text));
    this.view.focus();
  }

  getSelectionText() {
    const { state } = this.view;
    return state.sliceDoc(state.selection.main.from, state.selection.main.to);
  }

  /* --- block editing ------------------------------------------------------ */

  /**
   * Toggles a line prefix such as '# ' or '> ' on every selected line.
   * Applying a different heading level replaces the existing one rather than
   * stacking, which is what a writer expects from a heading button.
   */
  setLinePrefix(prefix) {
    const { state } = this.view;
    const changes = [];
    const seen = new Set();

    for (const range of state.selection.ranges) {
      const first = state.doc.lineAt(range.from).number;
      const last = state.doc.lineAt(range.to).number;

      for (let n = first; n <= last; n++) {
        if (seen.has(n)) continue;
        seen.add(n);

        const line = state.doc.line(n);
        const existing = line.text.match(/^(\s{0,3})(#{1,6}\s|>\s|[-*+]\s|\d+[.)]\s)?/);
        const currentPrefix = existing[2] || '';
        const indent = existing[1] || '';
        const rest = line.text.slice(indent.length + currentPrefix.length);

        // Same prefix again means "remove it".
        const next = currentPrefix === prefix ? '' : prefix;
        changes.push({ from: line.from, to: line.to, insert: indent + next + rest });
      }
    }

    if (changes.length) this.view.dispatch({ changes });
    this.view.focus();
  }

  /**
   * Toggles a class inside the block attribute list of the paragraph under
   * the caret, creating the list on its own line if there is none.
   *
   * Own line is not a style choice: Python-Markdown only reads a paragraph's
   * attributes there. Any permanent #p- id already present is carried over.
   */
  setBlockAttrs(className) {
    const { state } = this.view;
    const doc = state.doc;
    const caretLine = doc.lineAt(state.selection.main.head).number;

    // Walk out to the blank lines that bound this block.
    let last = caretLine;
    while (last < doc.lines && doc.line(last + 1).text.trim() !== '') last++;

    const lastLine = doc.line(last);
    const attrMatch = lastLine.text.match(/^(\s*)\{:?\s*([^}]*)\}\s*$/);

    if (attrMatch) {
      const parts = attrMatch[2].trim().split(/\s+/).filter(Boolean);
      const index = parts.indexOf(className);
      if (index >= 0) parts.splice(index, 1);
      else parts.unshift(className);

      // An empty attribute list is noise; remove the whole line instead.
      if (parts.length === 0) {
        const previous = doc.line(last - 1);
        this.view.dispatch({ changes: { from: previous.to, to: lastLine.to, insert: '' } });
      } else {
        this.view.dispatch({
          changes: { from: lastLine.from, to: lastLine.to, insert: `{: ${parts.join(' ')} }` },
        });
      }
    } else {
      this.view.dispatch({
        changes: { from: lastLine.to, insert: `\n{: ${className} }` },
      });
    }

    this.view.focus();
  }

  /**
   * Adds a line at the end of the document without disturbing the view.
   *
   * Rebuilding the whole document with setText would reset the scroll and
   * throw the caret back to the top - which is what made inserting a footnote
   * feel like losing your place. A plain edit at the end changes nothing else.
   */
  appendDefinition(line) {
    const doc = this.view.state.doc;
    const text = doc.toString();

    // Trim the trailing blank lines, then leave exactly one.
    const end = text.replace(/\s+$/, '').length;
    const separator = end === 0 ? '' : '\n\n';

    this.view.dispatch({
      changes: { from: end, to: doc.length, insert: `${separator}${line}\n` },
      // No selection change and no scrollIntoView: the caret stays where the
      // reference was just inserted.
    });
  }

  /** The attribute line of the block under the caret, or '' when it has none. */
  getBlockAttrs() {
    const doc = this.view.state.doc;
    const caretLine = doc.lineAt(this.view.state.selection.main.head).number;

    let last = caretLine;
    while (last < doc.lines && doc.line(last + 1).text.trim() !== '') last++;

    const text = doc.line(last).text;
    return /^\s*\{:?\s*[^}]*\}\s*$/.test(text) ? text : '';
  }

  /** Inserts text as a block of its own, with blank lines on both sides. */
  insertBlock(text) {
    const { state } = this.view;
    const line = state.doc.lineAt(state.selection.main.head);
    const before = line.text.trim() === '' ? '' : '\n\n';
    this.view.dispatch({
      changes: { from: line.to, insert: `${before}${text}\n` },
      selection: { anchor: line.to + before.length + text.length + 1 },
    });
    this.view.focus();
  }

  /* --- misc ---------------------------------------------------------------- */

  openSearch() { openSearchPanel(this.view); }
  undo() { undo(this.view); this.view.focus(); }
  redo() { redo(this.view); this.view.focus(); }
  focus() { this.view.focus(); }

  onCursor(fn) { this._cursorListeners.push(fn); }

  _notifyCursor() {
    const { state } = this.view;
    const pos = state.selection.main.head;
    const line = state.doc.lineAt(pos);
    const info = { line: line.number, column: pos - line.from + 1, total: state.doc.lines };
    this._cursorListeners.forEach((fn) => fn(info));
  }
}
