-- ==========================================================================
-- 02-fix-empty-save.sql — the bug that left a document EMPTY
-- --------------------------------------------------------------------------
-- Run this once in the SQL editor. It fixes real data loss.
--
-- WHAT WENT WRONG
-- The touch_document trigger reads the signed-in person's address:
--
--     select email from auth.users where id = auth.uid()
--
-- The auth schema is not readable by the `authenticated` role. Inside
-- claim_document that did not matter, because that function is SECURITY
-- DEFINER and runs as the owner - so claiming a lock, which inserts the row
-- with empty content, succeeded.
--
-- The save that followed came straight from the browser as `authenticated`,
-- the trigger hit auth.users, and the whole statement was refused. The studio
-- reported "ذخیره نشد" - correctly - but the empty row from the claim was
-- already there. Open it the next day and it is blank, because it always was.
--
-- THE FIX
-- The trigger becomes SECURITY DEFINER, so it can read the one column it
-- needs. Nothing else about it changes: it still only ever writes to the row
-- being saved.
-- ==========================================================================

create or replace function public.touch_document()
returns trigger
language plpgsql
security definer          -- <= this is the fix
set search_path = public, auth
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  new.updated_email := coalesce(
    (select email from auth.users where id = auth.uid()),
    new.updated_email
  );
  return new;
end;
$$;

-- --------------------------------------------------------------------------
-- A row with no content is not a document
--
-- Belt and braces: even if something else ever fails halfway, an empty row
-- must not be able to overwrite one that has text in it. The check refuses
-- the write rather than letting a blank through.
-- --------------------------------------------------------------------------
create or replace function public.refuse_blank_overwrite()
returns trigger
language plpgsql
as $$
begin
  if coalesce(new.content, '') = '' and coalesce(old.content, '') <> '' then
    raise exception 'refusing to overwrite % with empty content', old.path;
  end if;
  return new;
end;
$$;

drop trigger if exists documents_no_blank on public.documents;
create trigger documents_no_blank
  before update of content on public.documents
  for each row execute function public.refuse_blank_overwrite();
