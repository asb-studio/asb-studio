/* ==========================================================================
   model/frontmatter.js
   --------------------------------------------------------------------------
   Parses and serializes the YAML frontmatter block of a document.

   DESIGN RULE: this module is loss-free.
   Every line of the original frontmatter is kept verbatim in `entries`.
   A line is only re-generated when its value is actually changed through
   setField(). Unknown keys, comments, blank lines and odd spacing all
   survive a parse -> serialize round trip byte for byte.

   Why this matters: build.py reads fields the studio does not know about
   (summary, price, name, roles, socials). If the studio rewrote the whole
   block from a fixed template, opening an old file would silently delete
   them. So we never rewrite what we did not touch.

   This module must never touch the DOM.
   ========================================================================== */

const FENCE = /^(-{3}|\.{3})\s*$/;

/* --------------------------------------------------------------------------
   Value parsing
   Deliberately a small YAML subset - only what the project actually uses:
   scalars, quoted strings, booleans, null, and inline flow lists.
   Anything else is kept as an opaque raw string and handed back untouched.
   -------------------------------------------------------------------------- */

function parseScalar(text) {
  const t = text.trim();

  if (t === '') return { type: 'empty', value: '' };
  if (t === 'null' || t === '~') return { type: 'null', value: null };
  if (t === 'true' || t === 'false') return { type: 'bool', value: t === 'true' };

  // Inline flow list: [a, b, c]
  if (t.startsWith('[') && t.endsWith(']')) {
    const inner = t.slice(1, -1).trim();
    const items = inner === ''
      ? []
      : inner.split(',').map((s) => stripQuotes(s.trim())).filter((s) => s !== '');
    return { type: 'list', value: items };
  }

  // Quoted string
  if ((t.startsWith('"') && t.endsWith('"') && t.length > 1) ||
      (t.startsWith("'") && t.endsWith("'") && t.length > 1)) {
    return { type: 'quoted', value: stripQuotes(t) };
  }

  return { type: 'plain', value: t };
}

function stripQuotes(s) {
  if (s.length > 1 && s[0] === '"' && s[s.length - 1] === '"') {
    return s.slice(1, -1).replace(/\\"/g, '"');
  }
  if (s.length > 1 && s[0] === "'" && s[s.length - 1] === "'") {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  return s;
}

/* Decide the safest way to write a plain string back into YAML. */
function formatScalar(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);

  if (Array.isArray(value)) {
    return '[' + value.map((v) => formatListItem(String(v))).join(', ') + ']';
  }

  const s = String(value);

  // A bare 1405-05-03 is a YAML timestamp and a bare 20:00 is a sexagesimal
  // number - neither is the string build.py wants. The guide is explicit:
  // تاریخ همیشه در گیومه. Quoting here means every WRITTEN date carries them;
  // untouched lines keep whatever quoting they were found with.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) || /^\d{1,2}:\d{2}$/.test(s)) {
    return '"' + s + '"';
  }

  if (s === '') return '""';

  // Characters that would break a bare YAML scalar or confuse a reader.
  const needsQuotes =
    /^[\s]|[\s]$/.test(s) ||          // leading/trailing whitespace
    /^[-?:,\[\]{}#&*!|>'"%@`]/.test(s) || // YAML indicator at the start
    /:\s/.test(s) ||                   // "key: value" ambiguity
    /\s#/.test(s) ||                   // inline comment ambiguity
    /^(true|false|null|~|yes|no|on|off)$/i.test(s) ||
    /^-?\d+(\.\d+)?$/.test(s);         // would be read as a number

  if (!needsQuotes) return s;
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function formatListItem(s) {
  // Inside a flow list a comma or bracket must be quoted.
  if (/[,\[\]{}"']/.test(s) || s.trim() !== s || s === '') {
    return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }
  return s;
}

/* --------------------------------------------------------------------------
   Frontmatter object
   -------------------------------------------------------------------------- */

export class Frontmatter {
  /**
   * @param {Array} entries  ordered list of parsed lines
   * @param {boolean} present  whether the source file actually had a block
   * @param {string} openFence  the exact opening fence line ("---")
   * @param {string} closeFence the exact closing fence line ("---" or "...")
   */
  constructor(entries = [], present = false, openFence = '---', closeFence = '---') {
    this.entries = entries;
    this.present = present;
    this.openFence = openFence;
    this.closeFence = closeFence;
  }

  has(key) {
    return this.entries.some((e) => (e.kind === 'field' || e.kind === 'map') && e.key === key);
  }

  /** True when the key holds an indented block of sub-keys, like socials. */
  isMap(key) {
    return this.entries.some((e) => e.kind === 'map' && e.key === key);
  }

  /** Returns the parsed value, or `fallback` when the key is absent. */
  get(key, fallback = undefined) {
    const entry = this.entries.find((e) => e.kind === 'field' && e.key === key);
    return entry ? entry.value : fallback;
  }

  /** Returns every key in document order. */
  keys() {
    return this.entries
      .filter((e) => e.kind === 'field' || e.kind === 'map')
      .map((e) => e.key);
  }

  /* --------------------------------------------------------------------------
     Nested maps

     A creator profile carries a block like:

         socials:
           x: "https://x.com/…"
           telegram: "https://t.me/…"

     Before this, those indented lines were kept verbatim and nothing could
     edit them - safe, but it meant the form could not offer a field for a
     writer's Telegram. Each sub-key is now addressable, and any line the form
     does not touch still comes back exactly as it was found.
     -------------------------------------------------------------------------- */

  /** The whole block as a plain object. Empty object when the key is absent. */
  getMap(key) {
    const entry = this.entries.find((e) => e.kind === 'map' && e.key === key);
    if (!entry) return {};

    const out = {};
    for (const child of entry.children) out[child.key] = child.value;
    return out;
  }

  /**
   * Replaces the whole block. Sub-keys already present keep their original
   * line when their value has not changed, so quoting style stays stable.
   */
  setMap(key, values) {
    const clean = Object.entries(values)
      .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '');

    let entry = this.entries.find((e) => e.kind === 'map' && e.key === key);

    if (clean.length === 0) {
      // An empty block is noise in the file; drop the key entirely.
      if (entry) this.entries = this.entries.filter((e) => e !== entry);
      return this;
    }

    if (!entry) {
      entry = { kind: 'map', key, raw: `${key}:`, indent: '  ', children: [] };
      this.entries.push(entry);
      this.present = true;
    }

    const previous = new Map(entry.children.map((c) => [c.key, c]));

    entry.children = clean.map(([subKey, value]) => {
      const old = previous.get(subKey);
      if (old && String(old.value) === String(value)) return old;
      return { key: subKey, value, raw: `${entry.indent}${subKey}: ${formatScalar(value)}` };
    });

    return this;
  }

  /**
   * Sets a field. Only this one line is regenerated; everything else in the
   * block keeps its original bytes. A brand new key is appended at the end.
   */
  set(key, value) {
    const entry = this.entries.find((e) => e.kind === 'field' && e.key === key);
    const raw = `${key}: ${formatScalar(value)}`;

    if (entry) {
      // No-op guard: identical values leave the original line untouched,
      // which keeps quoting style stable across saves.
      if (sameValue(entry.value, value)) return this;
      entry.value = value;
      entry.raw = raw;
      entry.dirty = true;
    } else {
      this.entries.push({ kind: 'field', key, value, raw, dirty: true });
      this.present = true;
    }
    return this;
  }

  /**
   * Regenerates one line from its parsed value under the CURRENT formatting
   * rules. Used by normalizing so a bare legacy date picks up its quotes
   * without anyone retyping it. Values are untouched - only the rendering.
   */
  reformat(key) {
    const entry = this.entries.find((e) => e.kind === 'field' && e.key === key);
    if (!entry || entry.value === null || entry.value === undefined) return false;
    entry.raw = `${key}: ${formatScalar(entry.value)}`;
    entry.dirty = true;
    return true;
  }

  /** Removes a field entirely. */
  remove(key) {
    this.entries = this.entries.filter((e) =>
      !((e.kind === 'field' || e.kind === 'map') && e.key === key));
    return this;
  }

  /**
   * Puts the keys in a fixed order.
   *
   * Keys named in `order` come first, in that order. Anything else keeps its
   * relative position after them, and non-field lines (comments, blanks) go
   * last - a canonical block has no room for them in the middle.
   *
   * Lines themselves are untouched: this moves them, it does not rewrite them,
   * so quoting and spacing survive.
   */
  reorder(order) {
    const fields = this.entries.filter((e) => e.kind === 'field' || e.kind === 'map');
    const others = this.entries.filter((e) => e.kind === 'other');

    const named = [];
    for (const key of order) {
      const found = fields.find((e) => e.key === key);
      if (found) named.push(found);
    }

    const rest = fields.filter((e) => !named.includes(e));
    this.entries = [...named, ...rest, ...others];
    return this;
  }

  /** Plain object view. Convenient for filling a form; not for saving. */
  toObject() {
    const out = {};
    for (const e of this.entries) {
      if (e.kind === 'field') out[e.key] = e.value;
      else if (e.kind === 'map') out[e.key] = this.getMap(e.key);
    }
    return out;
  }

  /** Renders the block including its fences. Returns '' when absent. */
  serialize(eol = '\n') {
    if (!this.present) return '';

    const lines = [this.openFence];
    for (const entry of this.entries) {
      lines.push(entry.raw);
      if (entry.kind === 'map') for (const child of entry.children) lines.push(child.raw);
    }
    lines.push(this.closeFence);

    return lines.join(eol);
  }
}

function sameValue(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => String(v) === String(b[i]));
  }
  return a === b;
}

/* --------------------------------------------------------------------------
   Parsing entry point
   -------------------------------------------------------------------------- */

/**
 * Splits a full document into its frontmatter block and the rest.
 * @param {string} text  the whole file, already normalized to \n
 * @returns {{ frontmatter: Frontmatter, rest: string }}
 *   `rest` is everything after the closing fence line and its newline,
 *   kept verbatim so the body can be written back untouched.
 */
export function parseFrontmatter(text) {
  const lines = text.split('\n');

  if (lines.length === 0 || lines[0].trim() !== '---') {
    return { frontmatter: new Frontmatter([], false), rest: text };
  }

  let closeIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (FENCE.test(lines[i])) { closeIndex = i; break; }
  }

  // An unterminated block is not frontmatter. Treat the file as pure body
  // rather than guessing, so nothing is ever swallowed.
  if (closeIndex === -1) {
    return { frontmatter: new Frontmatter([], false), rest: text };
  }

  const entries = [];
  const CHILD = /^([ \t]+)([A-Za-z_][A-Za-z0-9_-]*)\s*:\s?(.*)$/;

  for (let i = 1; i < closeIndex; i++) {
    const raw = lines[i];
    const match = raw.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s?(.*)$/);

    if (match && !raw.startsWith(' ') && !raw.startsWith('\t')) {
      // A key with no value on its own line may open an indented block.
      if (match[2].trim() === '' && CHILD.test(lines[i + 1] || '')) {
        const children = [];
        let indent = '  ';
        let j = i + 1;

        while (j < closeIndex) {
          const child = lines[j].match(CHILD);
          if (!child) break;
          indent = child[1];
          children.push({ key: child[2], value: parseScalar(child[3]).value, raw: lines[j] });
          j++;
        }

        entries.push({ kind: 'map', key: match[1], raw, indent, children });
        i = j - 1;
        continue;
      }

      const parsed = parseScalar(match[2]);
      entries.push({
        kind: 'field',
        key: match[1],
        value: parsed.value,
        valueType: parsed.type,
        raw,
        dirty: false,
      });
    } else {
      // Comments, blank lines, block scalars, anything else.
      // Kept verbatim and never interpreted.
      entries.push({ kind: 'other', raw });
    }
  }

  const fm = new Frontmatter(entries, true, lines[0].trim(), lines[closeIndex].trim());

  // The leading '\n' is the newline that terminated the closing fence line.
  // split('\n') consumed it as a separator, so we put it back here - without
  // it, a parse -> serialize round trip would silently eat one blank line.
  const rest = '\n' + lines.slice(closeIndex + 1).join('\n');

  return { frontmatter: fm, rest };
}
