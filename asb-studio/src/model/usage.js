/* ==========================================================================
   model/usage.js
   --------------------------------------------------------------------------
   How much work has gone through the studio.

   BE HONEST ABOUT WHAT THIS IS: it lives in this browser's localStorage on
   this machine. Clearing browsing data erases it. Another browser, another
   laptop, or a colleague's copy each keep their own separate tally. It is a
   personal record of effort, not a shared statistic about the publishing
   house - and the studio says so plainly rather than implying otherwise.

   Time is counted only while there is actual typing. A tab left open
   overnight adds nothing, because an editor who walked away was not working.

   This module must never touch the DOM.
   ========================================================================== */

const KEY = 'asb-studio:usage';
const TICK_MS = 20000;      // how often an active minute is banked
const IDLE_MS = 90000;      // silence longer than this ends the working spell

const EMPTY = { minutes: 0, saves: 0, opens: 0, documents: {}, days: {}, since: null };

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : { ...EMPTY, since: Date.now() };
  } catch {
    return { ...EMPTY, since: Date.now() };
  }
}

function write(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); return true; } catch { return false; }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/* --------------------------------------------------------------------------
   Tracker
   -------------------------------------------------------------------------- */

export class UsageTracker {
  constructor() {
    this.data = read();
    if (!this.data.since) this.data.since = Date.now();
    this.lastActivity = 0;
    this.timer = null;
  }

  /** Call on every edit. Cheap: it only stamps a timestamp. */
  ping() {
    this.lastActivity = Date.now();
  }

  /** Records that a document was opened. */
  noteOpen(name) {
    this.data.opens++;
    const entry = this.data.documents[name] || { minutes: 0, saves: 0, opens: 0 };
    entry.opens++;
    entry.lastAt = Date.now();
    this.data.documents[name] = entry;
    write(this.data);
  }

  /** Records that a document was written to disk. */
  noteSave(name) {
    this.data.saves++;
    const entry = this.data.documents[name] || { minutes: 0, saves: 0, opens: 0 };
    entry.saves++;
    entry.lastAt = Date.now();
    this.data.documents[name] = entry;
    write(this.data);
  }

  /** Starts banking active time. Call once at boot. */
  start(currentName) {
    this.getName = currentName;
    this.timer = setInterval(() => this._tick(), TICK_MS);
    // A tab closed abruptly should still keep the spell it was in.
    window.addEventListener('beforeunload', () => write(this.data));
  }

  _tick() {
    if (!this.lastActivity) return;
    if (Date.now() - this.lastActivity > IDLE_MS) return;

    const minutes = TICK_MS / 60000;
    this.data.minutes += minutes;

    const day = today();
    this.data.days[day] = (this.data.days[day] || 0) + minutes;

    const name = this.getName ? this.getName() : null;
    if (name) {
      const entry = this.data.documents[name] || { minutes: 0, saves: 0, opens: 0 };
      entry.minutes += minutes;
      entry.lastAt = Date.now();
      this.data.documents[name] = entry;
    }

    write(this.data);
  }

  /** A read-only view, shaped for display. */
  report() {
    const documents = Object.entries(this.data.documents)
      .map(([name, entry]) => ({ name, ...entry, minutes: Math.round(entry.minutes) }))
      .sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));

    const days = Object.entries(this.data.days)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-14)
      .map(([day, minutes]) => ({ day, minutes: Math.round(minutes) }));

    return {
      minutes: Math.round(this.data.minutes),
      hours: Math.round((this.data.minutes / 60) * 10) / 10,
      saves: this.data.saves,
      opens: this.data.opens,
      documentCount: documents.length,
      since: this.data.since,
      documents: documents.slice(0, 20),
      days,
    };
  }

  /** Wipes the record. Only ever called when the author asks. */
  reset() {
    this.data = { ...EMPTY, since: Date.now(), documents: {}, days: {} };
    write(this.data);
  }

  /** Whether the record can be stored at all in this browser. */
  static isAvailable() {
    try {
      localStorage.setItem('asb-studio:probe', '1');
      localStorage.removeItem('asb-studio:probe');
      return true;
    } catch {
      return false;
    }
  }
}
