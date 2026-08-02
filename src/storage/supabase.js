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
   Signing in
   Email and a one-time code. Not a shared password: with one of those, the
   "who saved this" column means nothing and you can never tell which of you
   made a change.
   -------------------------------------------------------------------------- */

export async function currentUser() {
  const { data } = await supabase.auth.getSession();
  return data.session ? data.session.user : null;
}

/** Sends the six-digit code. */
export async function requestCode(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email: String(email).trim(),
    options: { shouldCreateUser: true },
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

export async function signOut() {
  await supabase.auth.signOut();
}

export function onAuthChange(fn) {
  supabase.auth.onAuthStateChange((_event, session) => fn(session ? session.user : null));
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
export async function claimDocument(path, minutes = LOCK_MINUTES) {
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
  const { data, error } = await supabase
    .from('documents')
    .upsert({ path, content }, { onConflict: 'path' })
    .select()
    .maybeSingle();

  if (error) {
    // RLS refusing an update surfaces as zero rows affected rather than a
    // permission error, so the message has to be made useful here.
    const err = new Error('ذخیره نشد — احتمالاً این فایل دست کس دیگری باز است.');
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

/** Suggests a workspace path for a file opened from disk. */
export function suggestPath(fileName, category = '') {
  const clean = String(fileName).replace(/\.(md|markdown)$/i, '');
  return category ? `main/${category}/${clean}.md` : `main/${clean}.md`;
}
