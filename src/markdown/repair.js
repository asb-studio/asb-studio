/* ==========================================================================
   markdown/repair.js
   --------------------------------------------------------------------------
   Fixes, in bulk, the mistakes lint.js reports.

   Every rule here corresponds to one lint rule, and every one of them has a
   single unambiguous correct form - which is the only reason automatic repair
   is safe. Anything requiring a judgement call is deliberately left out: a
   tool that guesses at an author's intent will eventually guess wrong, and
   silently.

   Each fix returns how many places it changed, so the studio can report what
   it did rather than quietly rewriting the file.

   This module must never touch the DOM.
   ========================================================================== */

/* Lines inside fenced code are never touched. */
function fencedLines(lines) {
  const inside = new Set();
  let open = false;
  lines.forEach((line, i) => {
    if (/^\s{0,3}(`{3,}|~{3,})/.test(line)) { open = !open; inside.add(i); return; }
    if (open) inside.add(i);
  });
  return inside;
}

/* --------------------------------------------------------------------------
   Individual fixes
   -------------------------------------------------------------------------- */

/* A trailing backslash prints literally in Python-Markdown. Inside a poem the
   newline is already preserved by CSS, so the backslash simply goes. */
function fixBackslashBreaks(lines, skip) {
  let count = 0;
  lines.forEach((line, i) => {
    if (skip.has(i)) return;
    if (!/\S\\$/.test(line)) return;
    lines[i] = line.replace(/\\$/, '');
    count++;
  });
  return count;
}

/* A paragraph's attribute list is only read on a line of its own. Headings are
   left alone here - they are the opposite case, handled below. */
function fixAttrSameLine(lines, skip) {
  let count = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (skip.has(i)) continue;
    if (/^\s{0,3}#{1,6}\s/.test(lines[i])) continue;

    const match = lines[i].match(/^(.*\S)[ \t]+(\{:?[ \t]*[.#][^}]*\})[ \t]*$/);
    if (!match) continue;

    lines.splice(i, 1, match[1], match[2]);
    count++;
  }
  return count;
}

/* A heading's attribute list is the mirror image: same line only. One sitting
   underneath is folded back up into the heading. */
function fixHeadingAttrs(lines, skip) {
  let count = 0;
  for (let i = lines.length - 1; i >= 1; i--) {
    if (skip.has(i)) continue;
    if (!/^[ \t]*\{:?[ \t]*[.#][^}]*\}[ \t]*$/.test(lines[i])) continue;
    if (!/^\s{0,3}#{1,6}\s/.test(lines[i - 1])) continue;

    const spec = lines[i].trim().replace(/^\{:?[ \t]*/, '').replace(/[ \t]*\}$/, '');
    lines.splice(i - 1, 2, `${lines[i - 1].trim()} {${spec}}`);
    count++;
  }
  return count;
}

/* build.py looks for a heading containing «سرچشمه». One that says «منابع» is
   never found, so the sources block loses its styling. */
function fixSourcesHeading(lines, skip) {
  let count = 0;
  lines.forEach((line, i) => {
    if (skip.has(i)) return;
    if (!/^#{1,6}\s/.test(line) || !/منابع/.test(line) || /سرچشمه/.test(line)) return;
    lines[i] = line.replace(/منابع/, 'سرچشمه‌ها');
    count++;
  });
  return count;
}

/* Pandoc's bracketed span is not a feature of Python-Markdown and prints
   verbatim. The supported equivalent attaches to a real inline element, so
   the text is wrapped in strong emphasis and keeps its classes. */
function fixPandocSpans(lines, skip) {
  let count = 0;
  const pattern = /\[([^\]\n]*)\]\{[ \t]*([.#][^}\n]*)\}/g;

  lines.forEach((line, i) => {
    if (skip.has(i)) return;
    if (!pattern.test(line)) return;
    pattern.lastIndex = 0;
    lines[i] = line.replace(pattern, (_, text, spec) => {
      count++;
      return `**${text}**{: ${spec.trim()} }`;
    });
  });
  return count;
}

/* --------------------------------------------------------------------------
   Public API
   -------------------------------------------------------------------------- */

export const FIXES = [
  { rule: 'backslash-break', label: 'شکست خط با بک‌اسلش', apply: fixBackslashBreaks },
  { rule: 'attr-same-line', label: 'ویژگی پاراگراف روی همان خط', apply: fixAttrSameLine },
  { rule: 'heading-attr-own-line', label: 'ویژگی عنوان در خط جدا', apply: fixHeadingAttrs },
  { rule: 'pandoc-span', label: 'نحو پندوکی [متن]{.کلاس}', apply: fixPandocSpans },
  { rule: 'sources-heading', label: 'عنوان «منابع» به‌جای «سرچشمه‌ها»', apply: fixSourcesHeading },
];

/**
 * Applies every automatic fix to a body.
 * @param {string} body
 * @param {string[]} only  optional list of rule ids to limit the run to
 * @returns {{ body: string, report: Array<{rule, label, count}>, total: number }}
 */
export function repairBody(body, only = null) {
  const lines = body.split('\n');
  const report = [];
  let total = 0;

  for (const fix of FIXES) {
    if (only && !only.includes(fix.rule)) continue;
    // The skip set is recomputed each pass because earlier fixes can add or
    // remove lines, which would otherwise shift every index in it.
    const count = fix.apply(lines, fencedLines(lines));
    if (count > 0) report.push({ rule: fix.rule, label: fix.label, count });
    total += count;
  }

  return { body: lines.join('\n'), report, total };
}

/** Counts what a repair run would change, without changing anything. */
export function previewRepair(body) {
  return repairBody(body).total;
}
