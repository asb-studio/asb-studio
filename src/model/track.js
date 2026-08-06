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

   The snapshot belongs to the person editing rather than to the file, so it
   lives in this browser and never reaches the .md.

   This module must never touch the DOM.
   ========================================================================== */

const KEY = 'asb-studio:tracking';

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

/** A stable key for a document: its workspace path, or its file name. */
export function documentKey(tab) {
  if (!tab) return null;
  return tab.remotePath || tab.name || null;
}

export function isTracking(tab) {
  const key = documentKey(tab);
  return Boolean(key && read()[key]);
}

/**
 * Starts recording. The text as it stands becomes the baseline.
 * @returns {boolean} false when the snapshot could not be stored
 */
export function startTracking(tab, body) {
  const key = documentKey(tab);
  if (!key) return false;

  const map = read();
  map[key] = { since: Date.now(), baseline: String(body) };
  return write(map);
}

export function stopTracking(tab) {
  const key = documentKey(tab);
  if (!key) return;

  const map = read();
  delete map[key];
  write(map);
}

/** The text as it was when recording started, or null. */
export function baselineOf(tab) {
  const key = documentKey(tab);
  const entry = key ? read()[key] : null;
  return entry ? entry.baseline : null;
}

export function trackingSince(tab) {
  const key = documentKey(tab);
  const entry = key ? read()[key] : null;
  return entry ? entry.since : null;
}

/**
 * Moves the baseline forward to the current text - everything up to now is
 * accepted as the new starting point. Used after a report has been sent and
 * a fresh pass begins.
 */
export function rebaseline(tab, body) {
  const key = documentKey(tab);
  if (!key) return false;

  const map = read();
  if (!map[key]) return false;

  map[key] = { since: Date.now(), baseline: String(body) };
  return write(map);
}
