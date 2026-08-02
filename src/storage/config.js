/* ==========================================================================
   storage/config.js
   --------------------------------------------------------------------------
   Where the shared workspace lives.

   BOTH VALUES BELOW ARE PUBLIC AND SAFE IN THIS FILE. The anon key is designed
   to ship inside a browser: on its own it can read and write nothing, because
   Row Level Security refuses every request that is not signed in. It is a
   doorbell, not a key.

   The one that must NEVER appear here, or anywhere in the studio, is the
   service_role key. That one bypasses every security rule. Its only home is
   the .env file on the laptop, where build.py uses it.
   ========================================================================== */

export const SUPABASE_URL = 'https://vaxkuqzetvgkrdpvltqq.supabase.co';

export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZheGt1cXpldHZna3JkcHZsdHFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU1OTE2ODMsImV4cCI6MjEwMTE2NzY4M30.OVRlAt1sWtj1r4PpSmKeSbF5EcPePytaicsvMkO50xU';

/* How long a lock is held before it lapses. Long enough for a working session,
   short enough that a laptop closed mid-edit does not block the other person
   until someone notices. */
export const LOCK_MINUTES = 30;

/* The lock is refreshed while the document stays open, so a long editing
   session never lapses under the author. */
export const LOCK_REFRESH_MS = 10 * 60 * 1000;
