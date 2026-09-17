-- Persist each account's named collections and membership without destructive replacement.
-- Snapshot current cloud state first so this migration is reversible per account.
insert into private.user_data_backups (user_id, snapshot)
select u.user_id, jsonb_build_object(
  'reason', 'before_account_collection_folders_migration',
  'collections', coalesce((select jsonb_agg(to_jsonb(c) - 'user_id') from public.collections c where c.user_id = u.user_id), '[]'::jsonb),
  'watch_history', coalesce((select jsonb_agg(to_jsonb(h) - 'user_id') from public.watch_history h where h.user_id = u.user_id), '[]'::jsonb),
  'watch_progress', coalesce((select jsonb_agg(to_jsonb(p) - 'user_id') from public.watch_progress p where p.user_id = u.user_id), '[]'::jsonb),
  'user_settings', coalesce((select to_jsonb(s) - 'user_id' from public.user_settings s where s.user_id = u.user_id), '{}'::jsonb),
  'created_at', now()
)
from (
  select user_id from public.collections
  union select user_id from public.user_settings
  union select user_id from public.watch_history
  union select user_id from public.watch_progress
) u;

alter table public.user_settings
  add column if not exists folders jsonb not null default '[]'::jsonb;

alter table public.collections
  add column if not exists folder_updated_at timestamptz;

update public.collections
set folder_updated_at = coalesce(folder_updated_at, added_at, now())
where folder_updated_at is null;

alter table public.collections
  alter column folder_updated_at set default now(),
  alter column folder_updated_at set not null;

create table if not exists public.collection_folders (
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 64),
  created_at timestamptz not null default now(),
  primary key (user_id, name)
);

alter table public.collection_folders enable row level security;
revoke all on public.collection_folders from anon;
grant select, insert, update, delete on public.collection_folders to authenticated;

drop policy if exists "Users can manage own collection folders" on public.collection_folders;
create policy "Users can manage own collection folders"
on public.collection_folders
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- Recover names from both legacy settings and actual item membership.
insert into public.collection_folders(user_id, name)
select c.user_id, btrim(c.folder)
from public.collections c
where nullif(btrim(c.folder), '') is not null
on conflict (user_id, name) do nothing;

insert into public.collection_folders(user_id, name)
select s.user_id, btrim(folder_name)
from public.user_settings s
cross join lateral jsonb_array_elements_text(
  case when jsonb_typeof(s.folders) = 'array' then s.folders else '[]'::jsonb end
) folder_name
where nullif(btrim(folder_name), '') is not null
on conflict (user_id, name) do nothing;

-- Membership writes also preserve the containing folder, including from old clients.
create or replace function public.preserve_collection_folder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(new.folder), '') is not null then
    insert into public.collection_folders(user_id, name)
    values (new.user_id, btrim(new.folder))
    on conflict (user_id, name) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.preserve_collection_folder() from public, anon, authenticated;

drop trigger if exists preserve_collection_folder_on_write on public.collections;
create trigger preserve_collection_folder_on_write
  after insert or update of folder on public.collections
  for each row execute procedure public.preserve_collection_folder();

create or replace function public.backup_my_user_data()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  backup_id bigint;
begin
  if caller is null then
    raise exception 'Authentication required';
  end if;

  select id into backup_id
  from private.user_data_backups
  where user_id = caller and created_at > now() - interval '24 hours'
  order by created_at desc
  limit 1;

  if backup_id is null then
    insert into private.user_data_backups (user_id, snapshot)
    values (caller, jsonb_build_object(
      'collections', coalesce((select jsonb_agg(to_jsonb(c) - 'user_id') from public.collections c where c.user_id = caller), '[]'::jsonb),
      'collection_folders', coalesce((select jsonb_agg(to_jsonb(f) - 'user_id') from public.collection_folders f where f.user_id = caller), '[]'::jsonb),
      'watch_history', coalesce((select jsonb_agg(to_jsonb(h) - 'user_id') from public.watch_history h where h.user_id = caller), '[]'::jsonb),
      'watch_progress', coalesce((select jsonb_agg(to_jsonb(p) - 'user_id') from public.watch_progress p where p.user_id = caller), '[]'::jsonb),
      'user_settings', coalesce((select to_jsonb(s) - 'user_id' from public.user_settings s where s.user_id = caller), '{}'::jsonb),
      'created_at', now()
    ))
    returning id into backup_id;

    delete from private.user_data_backups
    where user_id = caller
      and id not in (
        select id from private.user_data_backups
        where user_id = caller
        order by created_at desc
        limit 30
      );
  end if;

  return backup_id;
end;
$$;

revoke all on function public.backup_my_user_data() from public, anon;
grant execute on function public.backup_my_user_data() to authenticated;
