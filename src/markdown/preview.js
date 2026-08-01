/* ==========================================================================
   markdown/preview.js
   --------------------------------------------------------------------------
   Renders Markdown to HTML for the preview pane ONLY. Nothing here ever
   flows back into the document - the Markdown text stays the source of truth.

   The one job of this module is FIDELITY. The preview must show what
   build.py will show, including the ugly parts. A preview that quietly
   fixes the author's mistakes is worse than no preview, because the mistake
   then only surfaces on the live site.

   build.py uses Python-Markdown, not CommonMark, so markdown-it is bent to
   match it in four places. All four were verified against the real pipeline:

     1. a block attribute list applies only on a line of its own
     2. a HEADING attribute list is the exact opposite - same line only
     3. a trailing backslash is NOT a line break, it prints literally
     4. footnote anchors use the fn-1 / fnref-1 separator

   This module must never touch the DOM.
   ========================================================================== */

import { MarkdownIt, footnote } from '../../vendor/markdown-it.js';
import { markupForPreview } from './critic.js';
import { directionOfHtml } from './direction.js';

/* Sentinel used to hide a literal backslash from markdown-it's line-break
   rule. A private use area codepoint cannot occur in real Persian prose. */
const BACKSLASH_SENTINEL = '\uE000';

/* --------------------------------------------------------------------------
   Plugin: Python-Markdown style attribute lists
   -------------------------------------------------------------------------- */

/* Attribute list occupying a line of its own at the end of a block. */
const ATTR_OWN_LINE = /(?:^|\n)\{:?[ \t]*([.#][^}\n]*)\}[ \t]*$/;

/* Attribute list glued to the end of a heading's text. */
const ATTR_TRAILING = /[ \t]*\{:?[ \t]*([.#][^}\n]*)\}[ \t]*$/;

function applySpec(token, spec) {
  if (!token) return;
  const classes = [];

  for (const part of spec.trim().split(/\s+/)) {
    if (part.startsWith('.')) {
      classes.push(part.slice(1));
    } else if (part.startsWith('#')) {
      token.attrSet('id', part.slice(1));
    } else if (part.includes('=')) {
      const [key, ...rest] = part.split('=');
      token.attrSet(key, rest.join('=').replace(/^["']|["']$/g, ''));
    }
  }

  if (classes.length) {
    const existing = token.attrGet('class');
    token.attrSet('class', existing ? existing + ' ' + classes.join(' ') : classes.join(' '));
  }
}

function pymdAttrList(md) {
  md.core.ruler.push('pymd_attr_list', (state) => {
    const tokens = state.tokens;

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.type !== 'inline') continue;

      const owner = tokens[i - 1];
      if (!owner) continue;

      let match = null;

      if (owner.type === 'heading_open') {
        // Headings only accept attributes on the same line. An attribute list
        // sitting under a heading is a separate paragraph in this engine, and
        // the linter reports it as such.
        match = token.content.match(ATTR_TRAILING);
      } else if (owner.type === 'paragraph_open') {
        // Paragraphs are the mirror image: own line only.
        match = token.content.match(ATTR_OWN_LINE);
        // A paragraph consisting of nothing but an attribute list has no
        // block to attach to, so Python-Markdown prints it verbatim.
        if (match && match.index === 0 && match[0].length === token.content.length) {
          match = null;
        }
      }

      if (!match) continue;

      token.content = token.content.slice(0, match.index).replace(/[ \t]+$/, '');
      token.children = [];
      md.inline.parse(token.content, md, state.env, token.children);

      applySpec(owner, match[1]);
    }
  });
}

/* --------------------------------------------------------------------------
   Renderer
   -------------------------------------------------------------------------- */

/**
 * Builds a renderer configured the way build.py configures Python-Markdown.
 * @param {boolean} xhtml  close void elements, which EPUB requires
 */
export function createRenderer({ xhtml = false } = {}) {
  const instance = new MarkdownIt({
    html: true,          // build.py lets raw HTML through
    linkify: false,      // Python-Markdown does not auto-link bare URLs
    breaks: false,       // a lone newline is not a line break
    typographer: false,
    xhtmlOut: xhtml,
  });

  instance.use(footnote);
  instance.use(pymdAttrList);

  /* Footnote anchors, matching footnotes SEPARATOR = '-' in build.py, so the
     ids are the ids the reader's browser will really see. */
  instance.renderer.rules.footnote_ref = (tokens, idx) => {
    const n = Number(tokens[idx].meta.id) + 1;
    return '<sup id="fnref-' + n + '"><a class="footnote-ref" href="#fn-' + n + '">' + n + '</a></sup>';
  };
  instance.renderer.rules.footnote_open = (tokens, idx) => {
    const n = Number(tokens[idx].meta.id) + 1;
    return '<li id="fn-' + n + '" class="footnote-item">';
  };
  instance.renderer.rules.footnote_anchor = (tokens, idx) => {
    const n = Number(tokens[idx].meta.id) + 1;
    return ' <a href="#fnref-' + n + '" class="footnote-backref">&#8617;</a>';
  };

  return instance;
}

const md = createRenderer();

/**
 * Renders a Markdown body to preview HTML.
 * @param {string} body  markdown text, without frontmatter
 * @returns {string} HTML
 */
export { EN_TO_FA, matchBuildPy, BACKSLASH_SENTINEL };

export function renderPreview(body) {
  // Hide trailing backslashes from markdown-it, which would turn them into
  // line breaks. Python-Markdown does not, so neither may the preview.
  let source = body.replace(/\\(\r?\n)/g, BACKSLASH_SENTINEL + '$1');

  // Tracked changes are shown in colour rather than as raw braces. This is the
  // one deliberate departure from the site, and it is safe because a document
  // still carrying marks is blocked from publishing - see model/validate.js.
  source = markupForPreview(source);

  // The two structural markers are HTML comments, so they are invisible in a
  // faithful render. Showing them as labelled rules is the one deliberate
  // departure from the site: the author needs to see where the page splits.
  source = source
    .replace(/<!--\s*EREADER-START\s*-->/g,
             '<div class="marker">شروع متن اثر — بالای این خط، مقدمه‌ی صفحه است</div>')
    .replace(/<!--\s*PAYWALL\s*-->/g,
             '<div class="marker">دیوار پرداخت — از اینجا به بعد فقط برای خریدار</div>');

  try {
    const html = md.render(source).split(BACKSLASH_SENTINEL).join('\\');
    return matchBuildPy(html);
  } catch (err) {
    return '<p class="preview-error">خطا در رندر پیش‌نمایش: ' + escapeHtml(String(err)) + '</p>';
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* --------------------------------------------------------------------------
   Post-processing
   --------------------------------------------------------------------------
   build.py does not stop at converting Markdown. After Python-Markdown runs,
   it reshapes the result with BeautifulSoup: it renames the footnote block,
   gives it a Persian heading, sets dir="auto" on every footnote and source
   item so the numbering follows each entry's own language, and lifts the
   sources into a container of their own.

   None of that is Markdown, but all of it is what the reader ends up seeing.
   A preview that skipped it would be showing a page nobody ever visits, so it
   is reproduced here - in strings, since this module still may not touch the
   DOM.
   -------------------------------------------------------------------------- */

const EN_TO_FA = { '0': '۰', '1': '۱', '2': '۲', '3': '۳', '4': '۴',
                   '5': '۵', '6': '۶', '7': '۷', '8': '۸', '9': '۹' };

function matchBuildPy(input) {
  let html = input;

  // Reference numbers in the body are printed in Persian digits.
  html = html.replace(
    /(<a class="footnote-ref"[^>]*>)(\d+)(<\/a>)/g,
    (_, open, digits, close) => open + digits.replace(/\d/g, (d) => EN_TO_FA[d]) + close
  );

  // markdown-it calls the block <section class="footnotes">; the site calls it
  // <div class="footnote"> and prints a heading above it.
  html = html.replace(/<hr class="footnotes-sep">\s*/g, '');
  const footnoteMatch = html.match(/<section class="footnotes">[\s\S]*?<\/section>/);

  if (footnoteMatch) {
    const count = (footnoteMatch[0].match(/class="footnote-item"/g) || []).length;
    let block = footnoteMatch[0]
      .replace('<section class="footnotes">',
               `<div class="footnote"><h3>${count === 1 ? 'پانویس' : 'پانویس‌ها'}</h3>`)
      .replace(/<\/section>$/, '</div>');

    // Direction is decided per note by its content, not by dir="auto", which
    // reads only the first character and calls a mostly-Persian note Latin
    // whenever it opens with a Latin name. See markdown/direction.js.
    block = block.replace(
      /<li id="fn-(\d+)" class="footnote-item">([\s\S]*?)<\/li>/g,
      (whole, id, inner) =>
        `<li id="fn-${id}" class="footnote-item" dir="${directionOfHtml(inner)}">${inner}</li>`
    );

    html = html.replace(footnoteMatch[0], '');
    html = placeFootnotes(html, block);
  }

  return wrapSources(html);
}

/* The sources heading, if there is one, marks the end of the article. The
   footnotes belong above it, not after it. */
function placeFootnotes(html, block) {
  const heading = html.match(/<h[234][^>]*>[^<]*سرچشمه[\s\S]*?<\/h[234]>/);
  if (!heading) return html + block;
  return html.replace(heading[0], block + heading[0]);
}

function wrapSources(html) {
  const heading = html.match(/<h[234][^>]*>[^<]*سرچشمه[\s\S]*?<\/h[234]>/);
  if (!heading) return html;

  const at = html.indexOf(heading[0]);
  const before = html.slice(0, at);
  const rest = html.slice(at).replace(
    /<li>([\s\S]*?)<\/li>/g,
    (whole, inner) => `<li dir="${directionOfHtml(inner)}">${inner}</li>`
  );

  return `${before}<div class="sources-container">${rest}</div>`;
}
