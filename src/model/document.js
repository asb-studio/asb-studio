/* ==========================================================================
   model/document.js
   --------------------------------------------------------------------------
   The document model. A document is exactly two things:

       1. a frontmatter block
       2. a body of raw Markdown text

   There is no HTML anywhere in this model, and no intermediate tree. The
   Markdown IS the document. The preview pane will render from it, but never
   back into it.

   The contract this module guarantees:

       serialize(parse(text)) === text       when nothing was changed

   That guarantee is what makes it safe to open an already published .md
   file, touch one field, and save it back. Anything that breaks it is a bug,
   and test/index.html exists to catch exactly that.

   This module must never touch the DOM.
   ========================================================================== */

import { parseFrontmatter, Frontmatter } from './frontmatter.js';

export class AsbDocument {
  constructor() {
    this.frontmatter = new Frontmatter();
    this.body = '';          // markdown body, no leading/trailing blank lines

    /* --- fidelity bookkeeping ------------------------------------------
       These fields exist purely so an untouched file serializes back
       byte-identically. They are not part of the authored content.       */
    this.eol = '\n';         // '\n' or '\r\n', restored on serialize
    this.bom = false;        // whether the file started with a UTF-8 BOM
    this.rawRest = null;     // verbatim text after the frontmatter fence
    this.bodyDirty = false;  // set once the body is actually edited
  }

  /** Marks the body as changed. Call this from the editor, not from loaders. */
  setBody(text) {
    this.body = text;
    this.bodyDirty = true;
    return this;
  }

  /**
   * Renders the complete .md file.
   *
   * If the body was never edited we replay the original bytes exactly.
   * If it was edited we emit the canonical shape:
   *
   *     ---
   *     <frontmatter>
   *     ---
   *     <blank line>
   *     <body>
   *     <single trailing newline>
   */
  serialize() {
    // Everything is assembled with plain \n, then converted once at the very
    // end. Mixing both while building is how stray \r\n\n pairs get created.
    const fm = this.frontmatter.serialize('\n');

    let rest;
    if (!this.bodyDirty && this.rawRest !== null) {
      rest = this.rawRest;
    } else {
      // One blank line between the fence and the body; exactly one trailing
      // newline at the end of file. Same shape every single time.
      rest = (fm ? '\n\n' : '') + normalizeBody(this.body) + '\n';
    }

    let out = fm + rest;
    if (this.eol === '\r\n') out = out.replace(/\n/g, '\r\n');

    return (this.bom ? '\uFEFF' : '') + out;
  }
}

/* Collapses runs of 3+ blank lines and strips edge whitespace, so output is
   deterministic no matter how the editor buffer happened to end. */
function normalizeBody(body) {
  return body
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\s+$/, '');
}

/**
 * Parses a raw .md file into a document.
 * @param {string} text  the file contents as read from disk
 * @returns {AsbDocument}
 */
export function parseDocument(text) {
  const doc = new AsbDocument();

  let src = text;

  if (src.charCodeAt(0) === 0xfeff) {
    doc.bom = true;
    src = src.slice(1);
  }

  // Detect line endings before normalizing, so we can restore them later.
  doc.eol = src.includes('\r\n') ? '\r\n' : '\n';
  src = src.replace(/\r\n/g, '\n');

  const { frontmatter, rest } = parseFrontmatter(src);
  doc.frontmatter = frontmatter;

  // rawRest holds the original spacing verbatim. When the frontmatter block
  // is absent this is simply the whole file, so both cases round trip.
  doc.rawRest = rest;

  // The authored body is the same text with its edge blank lines removed.
  doc.body = rest.replace(/^\n+/, '').replace(/\s+$/, '');
  doc.bodyDirty = false;

  return doc;
}

/** Convenience wrapper used by the tests. */
export function serializeDocument(doc) {
  return doc.serialize();
}

/* --------------------------------------------------------------------------
   Frontmatter that ended up in the body

   The frontmatter lives in the publish panel, not in the text pane. Paste it
   into the text instead and it becomes body content, so the saved file gets
   two blocks - the real one and a copy that renders as a horizontal rule with
   a wall of text between it.

   Easy mistake, and easy to fix, so the studio detects it rather than letting
   it reach the site.
   -------------------------------------------------------------------------- */

const LEADING_BLOCK = /^---\n([\s\S]*?)\n---(\n|$)/;

/** True when the body opens with something shaped like a frontmatter block. */
export function hasEmbeddedFrontmatter(doc) {
  const match = doc.body.match(LEADING_BLOCK);
  if (!match) return false;
  // At least one `key: value` line, otherwise it is just two rules with text
  // between them, which is legitimate Markdown.
  return /^[A-Za-z_][A-Za-z0-9_-]*\s*:/m.test(match[1]);
}

/**
 * Removes the block from the body. When the document has no frontmatter of
 * its own the block is moved into it rather than thrown away; when it already
 * has one, the copy in the body is simply dropped.
 *
 * @returns {{ moved: boolean, fields: number }}
 */
export function liftEmbeddedFrontmatter(doc) {
  if (!hasEmbeddedFrontmatter(doc)) return { moved: false, fields: 0 };

  const match = doc.body.match(LEADING_BLOCK);
  const rest = doc.body.slice(match[0].length).replace(/^\n+/, '');

  if (doc.frontmatter.present && doc.frontmatter.keys().length > 0) {
    doc.setBody(rest);
    return { moved: false, fields: 0 };
  }

  const parsed = parseFrontmatter(`---\n${match[1]}\n---\n`);
  doc.frontmatter = parsed.frontmatter;
  doc.setBody(rest);
  return { moved: true, fields: doc.frontmatter.keys().length };
}
