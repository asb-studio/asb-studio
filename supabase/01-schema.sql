-- ==========================================================================
-- 01-schema.sql — the shared workspace
-- --------------------------------------------------------------------------
-- Run this once in the Supabase SQL editor.
--
-- ONE TABLE. It holds the text of each Markdown file, who touched it last,
-- and who currently has it open. That last part matters more than it looks:
-- you and your editor do not type into the same paragraph at the same second,
-- you take turns. A lock is what turns "taking turns" from an agreement into
-- something the tool enforces. Real simultaneous editing is a far harder
-- problem and one you do not have.
--
-- Row Level Security is on from the first line, and the policies allow only
-- signed-in people. An anon key alone gets nothing, which is what makes it
-- safe to ship that key inside the studio.
-- ==========================================================================

create extension if not exists "pgcrypto";

-- --------------------------------------------------------------------------
-- documents
-- --------------------------------------------------------------------------
create table if not exists public.documents (
  -- The path inside the site repository, e.g.
  -- main/short-story/single/desmond-warzel/wikihistory/wikihistory.md
  -- This is the identity of a document. It is stable, human readable, and
  -- already unique.
  path          text primary key,

  -- The whole file, frontmatter and body together, exactly as the studio
  -- would write it to disk.
  content       text not null default '',

  -- Bookkeeping.
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users (id),
  updated_email text,

  -- Soft lock. Whoever holds it has the file open; everyone else opens it
  -- read-only until the lease runs out.
  locked_by     uuid references auth.users (id),
  locked_email  text,
  locked_until  timestamptz
);

comment on table public.documents is
  'Markdown files shared between the publishing house members. Path is the identity.';

create index if not exists documents_updated_at_idx
  on public.documents (updated_at desc);

-- --------------------------------------------------------------------------
-- Keep updated_at honest
-- Left to the application, this column eventually lies. A trigger cannot.
-- --------------------------------------------------------------------------
create or replace function public.touch_document()
returns trigger
language plpgsql
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

drop trigger if exists documents_touch on public.documents;
create trigger documents_touch
  before insert or update of content on public.documents
  for each row execute function public.touch_document();

-- --------------------------------------------------------------------------
-- Row Level Security
-- --------------------------------------------------------------------------
alter table public.documents enable row level security;

drop policy if exists documents_read on public.documents;
create policy documents_read
  on public.documents for select
  to authenticated
  using (true);

drop policy if exists documents_insert on public.documents;
create policy documents_insert
  on public.documents for insert
  to authenticated
  with check (true);

-- A write is refused while somebody else holds a live lock. The database is
-- the only place this check cannot be forgotten.
drop policy if exists documents_update on public.documents;
create policy documents_update
  on public.documents for update
  to authenticated
  using (
    locked_by is null
    or locked_by = auth.uid()
    or locked_until < now()
  );

drop policy if exists documents_delete on public.documents;
create policy documents_delete
  on public.documents for delete
  to authenticated
  using (true);

-- --------------------------------------------------------------------------
-- Taking and releasing the lock
-- Done in the database so two people cannot both be told "yes" at once.
-- --------------------------------------------------------------------------
create or replace function public.claim_document(doc_path text, minutes int default 30)
returns public.documents
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.documents;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  insert into public.documents (path, content)
  values (doc_path, '')
  on conflict (path) do nothing;

  update public.documents d
     set locked_by = auth.uid(),
         locked_email = (select email from auth.users where id = auth.uid()),
         locked_until = now() + make_interval(mins => minutes)
   where d.path = doc_path
     and (d.locked_by is null or d.locked_by = auth.uid() or d.locked_until < now())
  returning * into row;

  if row.path is null then
    raise exception 'locked_by_other';
  end if;

  return row;
end;
$$;

create or replace function public.release_document(doc_path text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.documents
     set locked_by = null, locked_email = null, locked_until = null
   where path = doc_path
     and locked_by = auth.uid();
end;
$$;

grant execute on function public.claim_document(text, int) to authenticated;
grant execute on function public.release_document(text) to authenticated;
