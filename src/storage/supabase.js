/* ==========================================================================
   storage/supabase.js
   --------------------------------------------------------------------------
   The shared workspace: the same documents, on both laptops.

   This sits beside storage/files.js rather than replacing it. Local files
   still work exactly as they did; this is a second place a document can come
   from. Nothing else in the studio knows the difference, which is the whole
   reason all disk access was confined to one folder from the start.

   WHAT THIS IS NOT: simultaneous editing. Two people typing into one
   paragraph at the same moment is a genuinely hard problem and not one you
   have - you take turns. So the model here is a lock: whoever opens a
   document holds it, everyone else sees it read-only until they are done or
   the lease lapses. The lock is enforced by the database, not by this file,
   because a rule in the browser is a rule that can be skipped.
   ========================================================================== */

import { createClient } from '../../vendor/supabase.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, LOCK_MINUTES } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

/* --------------------------------------------------------------------------
   Accounts

   ONE-TIME CODES ONLY. No password is chosen, stored, or asked for - a
   password is a thing to forget, to reuse from somewhere else, and to have to
   reset. An address and a name are all this needs, and the code proves the
   address on the spot.

   So there is really one flow, not two. Signing up is signing in for the
   first time, with a name attached; every visit after that is the same
   request without one.
   -------------------------------------------------------------------------- */

export async function currentUser() {
  const { data } = await supabase.auth.getSession();
  return data.session ? data.session.user : null;
}

/** The name to show. Falls back to the part of the address before the @. */
export function displayName(user) {
  if (!user) return '';
  const meta = user.user_metadata || {};
  return meta.display_name || meta.name || String(user.email || '').split('@')[0];
}

/**
 * Sends the code.
 *
 * @param {string} email
 * @param {string|null} name  given on a first visit; the account is created
 *                            with it. Absent on later visits, and Supabase
 *                            then refuses unknown addresses - which is what
 *                            keeps "sign in" from quietly creating accounts.
 */
export async function requestCode(email, name = null) {
  const options = { shouldCreateUser: Boolean(name) };
  if (name) options.data = { display_name: String(name).trim() };

  const { error } = await supabase.auth.signInWithOtp({
    email: String(email).trim(),
    options,
  });
  if (error) throw error;
}

/** Exchanges the code for a session. */
export async function verifyCode(email, token) {
  const { data, error } = await supabase.auth.verifyOtp({
    email: String(email).trim(),
    token: String(token).trim(),
    type: 'email',
  });
  if (error) throw error;
  return data.user;
}

export async function updateName(name) {
  const { error } = await supabase.auth.updateUser({
    data: { display_name: String(name).trim() },
  });
  if (error) throw error;
}

/* --------------------------------------------------------------------------
   Documents
   -------------------------------------------------------------------------- */

/** Everything in the workspace, newest first. Content is not fetched here. */
export async function listDocuments() {
  const { data, error } = await supabase
    .from('documents')
    .select('path, updated_at, updated_email, locked_by, locked_email, locked_until')
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return (data || []).map(decorate);
}

/* Whether a lock is live is a question about time, and the answer changes
   without anything being written - so it is worked out on read. */
function decorate(row) {
  const locked = Boolean(row.locked_until) && new Date(row.locked_until) > new Date();
  return { ...row, isLocked: locked, lockedBy: locked ? row.locked_email : null };
}

export async function readDocument(path) {
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('path', path)
    .maybeSingle();

  if (error) throw error;
  return data ? decorate(data) : null;
}

/**
 * Takes the lock, creating the row if this is a new path.
 * @throws when somebody else holds a live lock
 */
export async function claimDocument(path, minutes = LOCK_MINUTES, content = null) {
  const { data, error } = await supabase.rpc('claim_document', {
    doc_path: path,
    minutes,
  });

  if (error) {
    if (String(error.message || '').includes('locked_by_other')) {
      const existing = await readDocument(path);
      const holder = existing && existing.lockedBy ? existing.lockedBy : 'کس دیگری';
      const err = new Error(`این فایل دست ${holder} باز است.`);
      err.code = 'locked';
      throw err;
    }
    throw error;
  }

  return Array.isArray(data) ? decorate(data[0]) : decorate(data);
}

export async function releaseDocument(path) {
  const { error } = await supabase.rpc('release_document', { doc_path: path });
  if (error) throw error;
}

/**
 * Saves. The database refuses the write outright when somebody else holds the
 * lock, so this cannot quietly overwrite their work.
 */
export async function writeDocument(path, content) {
  // Never write nothing. An empty save is always a bug somewhere upstream,
  // and letting it through is how a finished story became a blank row.
  if (String(content || '').trim() === '') {
    const err = new Error('متن خالی است و ذخیره نشد.');
    err.code = 'empty';
    throw err;
  }

  const { data, error } = await supabase
    .from('documents')
    .upsert({ path, content }, { onConflict: 'path' })
    .select()
    .maybeSingle();

  if (error) {
    // RLS refusing an update surfaces as zero rows affected rather than a
    // permission error, so the message has to be made useful here.
    const err = new Error(
      `ذخیره نشد: ${error.message || 'خطای ناشناخته'}`
      + ' — اگر تازه پایگاه‌داده را ساخته‌ای، فایل supabase/02-fix-empty-save.sql را اجرا کن.');
    err.code = 'denied';
    err.cause = error;
    throw err;
  }

  return data ? decorate(data) : null;
}

export async function deleteDocument(path) {
  const { error } = await supabase.from('documents').delete().eq('path', path);
  if (error) throw error;
}

/* --------------------------------------------------------------------------
   Leaving

   These two have now gone missing twice in edits to this file, each time
   taking the whole app down at boot, because main.js imports them by name and
   a missing named export is a load-time failure, not a runtime one. Keeping
   them under their own heading makes them harder to sweep away with a
   neighbouring block.
   -------------------------------------------------------------------------- */

export async function signOut() {
  await supabase.auth.signOut();
}

export function onAuthChange(fn) {
  supabase.auth.onAuthStateChange((_event, session) => fn(session ? session.user : null));
}

/* --------------------------------------------------------------------------
   Who is here

   Realtime presence rather than a table: being online is not a fact worth
   storing. It is true only while a browser is open, and a row saying someone
   is here is a row that goes stale the moment their laptop lid closes.
   Presence is held by the connection itself, so it cannot lie.
   -------------------------------------------------------------------------- */

let presenceChannel = null;

/**
 * Announces this person and reports everyone else.
 * @param {object} me  { email, name }
 * @param {(people: Array) => void} onChange
 */
export function joinPresence(me, onChange) {
  if (presenceChannel) return presenceChannel;

  presenceChannel = supabase.channel('studio-presence', {
    config: { presence: { key: me.email } },
  });

  const report = () => {
    const state = presenceChannel.presenceState();
    const people = Object.values(state)
      .flat()
      .map((entry) => ({ email: entry.email, name: entry.name, at: entry.at }));

    // One person, many tabs, one entry.
    const unique = new Map(people.map((p) => [p.email, p]));
    onChange([...unique.values()]);
  };

  presenceChannel
    .on('presence', { event: 'sync' }, report)
    .on('presence', { event: 'join' }, report)
    .on('presence', { event: 'leave' }, report)
    .subscribe(async (status) => {
      if (status !== 'SUBSCRIBED') return;
      await presenceChannel.track({ email: me.email, name: me.name, at: new Date().toISOString() });
    });

  return presenceChannel;
}

export async function leavePresence() {
  if (!presenceChannel) return;
  await presenceChannel.untrack();
  await supabase.removeChannel(presenceChannel);
  presenceChannel = null;
}

/** Suggests a workspace path for a file opened from disk. */
export function suggestPath(fileName, category = '') {
  const clean = String(fileName).replace(/\.(md|markdown)$/i, '');
  return category ? `main/${category}/${clean}.md` : `main/${clean}.md`;
}
