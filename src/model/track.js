/* ==========================================================================
   model/track.js
   --------------------------------------------------------------------------
   Recording what an editing pass changed.

   THE SWITCH KEEPS A SNAPSHOT, and that is the whole design. Turning tracking
   on stores the text exactly as it stands; from then on the editor writes
   normally, and what changed is worked out by comparing that snapshot with
   the text now.

   The alternative - asking the editor to press a button for every word they
   touch - is what the studio did before, and it is not editing, it is
   bookkeeping. Word does not work that way either.

   Comments are the exception and stay manual, because a comment is not a
   change to the text; it is something said about it, and no comparison can
   guess at it.

   WHERE THE SNAPSHOT LIVES, AND WHY IT SPLIT:

     A workspace PATH is unique everywhere, so its baseline persists in
     localStorage and survives a reload.
     A LOCAL file is keyed by its NAME alone - and half the archive is called
     index.md. A persistent map keyed that way let one file's baseline light
     the tracker for a stranger that happened to share the name. So local
     tracking is SESSION-ONLY: it lives in memory, dies with the tab, and can
     never haunt the next document.

   Baselines are stored normalized (\n). The editor text is \n already; a
   CRLF baseline straight from the workspace used to shift every offset
   after its first carriage return.

   This module must never touch the DOM.
   ========================================================================== */

const KEY = 'asb-studio:tracking';

const normalizeText = (text) => String(text || '').replace(/\r\n?/g, '\n');

/* The persistent map: workspace paths only. */
function read() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function write(map) {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
    return true;
  } catch {
    // A long manuscript can outgrow the quota. Losing the baseline silently
    // would be worse than saying so, which is what the caller does with false.
    return false;
  }
}

/* The session map: local files. Dies with the tab, by design. */
const session = new Map();

/** A stable key for a document: its workspace path, or its file name. */
export function documentKey(tab) {
  if (!tab) return null;
  return tab.remotePath || tab.name || null;
}

export function isTracking(tab) {
  const key = documentKey(tab);
  if (!key) return false;
  return tab.remotePath ? Boolean(read()[key]) : session.has(key);
}

/**
 * Starts recording. The text as it stands becomes the baseline.
 * @returns {boolean} false when the snapshot could not be stored
 */
export function startTracking(tab, body) {
  const key = documentKey(tab);
  if (!key) return false;

  const entry = { since: Date.now(), baseline: normalizeText(body) };
  if (tab.remotePath) return write({ ...read(), [key]: entry });
  session.set(key, entry);
  return true;
}

export function stopTracking(tab) {
  const key = documentKey(tab);
  if (!key) return;

  if (tab.remotePath) {
    const map = read();
    delete map[key];
    write(map);
  } else {
    session.delete(key);
  }
}

/** The text as it was when recording started, or null. */
export function baselineOf(tab) {
  const key = documentKey(tab);
  if (!key) return null;
  const entry = tab.remotePath ? read()[key] : session.get(key);
  return entry ? entry.baseline : null;
}

export function trackingSince(tab) {
  const key = documentKey(tab);
  if (!key) return null;
  const entry = tab.remotePath ? read()[key] : session.get(key);
  return entry ? entry.since : null;
}

/**
 * Moves the baseline forward to the current text - everything up to now is
 * accepted as the new starting point. Used after a change has been accepted
 * or a report has been sent and a fresh pass begins.
 */
export function rebaseline(tab, body) {
  const key = documentKey(tab);
  if (!key) return false;

  const entry = { since: Date.now(), baseline: normalizeText(body) };
  if (tab.remotePath) return write({ ...read(), [key]: entry });
  session.set(key, entry);
  return true;
}
