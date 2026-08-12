-- ==========================================================================
-- 03-baseline.sql — so the other person sees what changed
-- --------------------------------------------------------------------------
-- Run once in the SQL editor.
--
-- Tracked changes are a comparison between the text now and the text as it
-- was when recording started. That "as it was" snapshot lived only in the
-- editor's own browser - so the second person received the finished text with
-- nothing to compare it against, and saw no changes at all.
--
-- The snapshot travels with the document now. One column.
-- ==========================================================================

alter table public.documents
  add column if not exists baseline text;

comment on column public.documents.baseline is
  'The text as it stood when tracking was switched on. Null when nobody is tracking.';
