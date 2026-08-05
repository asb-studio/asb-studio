/* ==========================================================================
   model/track.js
   --------------------------------------------------------------------------
   Whether tracked changes are being recorded.

   Until now the marks were always available and it was on the editor to
   remember to use them - which is not how anybody works. In Word the switch
   is a switch: you turn it on when you start a pass, and from that moment
   what you do is recorded.

   The state is per document rather than global, because one file can be
   under review while another is being drafted, and it belongs to the person
   editing rather than to the file - so it lives in this browser, keyed by
   document, and never reaches the .md.

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
  try { localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* private mode */ }
}

/** A stable key for a document: its workspace path, or its file name. */
export function documentKey(tab) {
  if (!tab) return null;
  return tab.remotePath || tab.name || null;
}

export function isTracking(tab) {
  const key = documentKey(tab);
  if (!key) return false;
  return Boolean(read()[key]);
}

export function setTracking(tab, on) {
  const key = documentKey(tab);
  if (!key) return false;

  const map = read();
  if (on) map[key] = { since: Date.now() };
  else delete map[key];

  write(map);
  return on;
}

export function trackingSince(tab) {
  const key = documentKey(tab);
  const entry = key ? read()[key] : null;
  return entry ? entry.since : null;
}
