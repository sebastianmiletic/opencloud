-- Server-enforced signup abuse protection and one-time removal of known bot accounts.
-- Client installation IDs are friction against casual abuse, not hardware attestation.

create table if not exists private.signup_device_accounts (
  install_id uuid not null,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (install_id, user_id)
);
revoke all on private.signup_device_accounts from public, anon, authenticated;

create table if not exists private.security_cleanup_log (
  id bigint generated always as identity primary key,
  action text not null,
  affected_accounts integer not null check (affected_accounts >= 0),
  occurred_at timestamptz not null default now()
);
revoke all on private.security_cleanup_log from public, anon, authenticated;

-- Preserve known installation/account associations before changing the key shape.
insert into private.signup_device_accounts(install_id, user_id, created_at)
select install_id, user_id, first_seen_at
from public.app_installations
on conflict (install_id, user_id) do nothing;

alter table public.app_usage_sessions
  drop constraint if exists app_usage_sessions_install_id_fkey;
alter table public.app_installations
  drop constraint if exists app_installations_pkey;
alter table public.app_installations
  add constraint app_installations_pkey primary key (install_id, user_id);
alter table public.app_usage_sessions
  add constraint app_usage_sessions_installation_fkey
  foreign key (install_id, user_id)
  references public.app_installations(install_id, user_id)
  on delete cascade;

create or replace function private.before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(event->'user'->>'email', '')));
  v_domain text := split_part(v_email, '@', 2);
  v_install_text text := coalesce(
    event->'user'->'user_metadata'->>'opencloud_install_id',
    event->'user'->'raw_user_meta_data'->>'opencloud_install_id',
    ''
  );
  v_install_id uuid;
begin
  if v_domain = 'example.com' then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403,
      'message', 'This email domain is not allowed.'
    ));
  end if;

  if v_install_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 400,
      'message', 'A valid OpenCloud installation is required.'
    ));
  end if;
  v_install_id := v_install_text::uuid;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_install_id::text, 0));
  if (select count(*) from private.signup_device_accounts where install_id = v_install_id) >= 5 then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 429,
      'message', 'This installation has reached the five-account limit.'
    ));
  end if;

  return '{}'::jsonb;
end;
$$;
revoke all on function private.before_user_created(jsonb) from public, anon, authenticated;
grant usage on schema private to supabase_auth_admin;
grant execute on function private.before_user_created(jsonb) to supabase_auth_admin;

create or replace function private.register_signup_device()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_install_text text := coalesce(new.raw_user_meta_data->>'opencloud_install_id', '');
begin
  if v_install_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    insert into private.signup_device_accounts(install_id, user_id)
    values (v_install_text::uuid, new.id)
    on conflict (install_id, user_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function private.register_signup_device() from public, anon, authenticated;

drop trigger if exists on_auth_user_registered_device on auth.users;
create trigger on_auth_user_registered_device
  after insert on auth.users
  for each row execute procedure private.register_signup_device();

create or replace function private.remove_signup_device()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from private.signup_device_accounts where user_id = old.id;
  return old;
end;
$$;
revoke all on function private.remove_signup_device() from public, anon, authenticated;

drop trigger if exists on_auth_user_remove_signup_device on auth.users;
create trigger on_auth_user_remove_signup_device
  after delete on auth.users
  for each row execute procedure private.remove_signup_device();

drop function if exists public.heartbeat_installation(uuid, text, text, text);

create or replace function public.heartbeat_app_activity(
  p_install_id uuid,
  p_session_id uuid,
  p_app_version text,
  p_platform text,
  p_architecture text,
  p_device_kind text
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_device text := lower(btrim(coalesce(p_device_kind, 'laptop')));
begin
  if auth.uid() is null or not public.account_is_active() then
    raise exception 'Active account required' using errcode = '42501';
  end if;
  if p_install_id is null or p_session_id is null then
    raise exception 'Installation and session IDs required' using errcode = '22023';
  end if;
  if v_device not in ('laptop', 'tv', 'phone') then v_device := 'laptop'; end if;
  if exists (
    select 1 from public.app_usage_sessions
    where session_id = p_session_id and user_id <> auth.uid()
  ) then
    raise exception 'Session ID belongs to another account' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_install_id::text, 0));
  if not exists (
    select 1 from private.signup_device_accounts
    where install_id = p_install_id and user_id = auth.uid()
  ) and (select count(*) from private.signup_device_accounts where install_id = p_install_id) >= 5 then
    raise exception 'This installation has reached the five-account limit' using errcode = 'P0001';
  end if;
  insert into private.signup_device_accounts(install_id, user_id)
  values (p_install_id, auth.uid())
  on conflict (install_id, user_id) do nothing;

  insert into public.app_installations(
    install_id, user_id, app_version, platform, architecture, device_kind,
    first_seen_at, last_seen_at
  ) values (
    p_install_id, auth.uid(),
    left(coalesce(nullif(btrim(p_app_version), ''), 'unknown'), 32),
    left(coalesce(nullif(btrim(p_platform), ''), 'unknown'), 32),
    left(coalesce(nullif(btrim(p_architecture), ''), 'unknown'), 32),
    v_device, v_now, v_now
  )
  on conflict (install_id, user_id) do update set
    app_version = excluded.app_version,
    platform = excluded.platform,
    architecture = excluded.architecture,
    device_kind = excluded.device_kind,
    last_seen_at = v_now;

  insert into public.app_usage_sessions(
    session_id, install_id, user_id, started_at, last_seen_at, active_seconds
  ) values (p_session_id, p_install_id, auth.uid(), v_now, v_now, 0)
  on conflict (session_id) do update set
    install_id = excluded.install_id,
    last_seen_at = v_now,
    active_seconds = public.app_usage_sessions.active_seconds + greatest(
      0,
      least(90, extract(epoch from (v_now - public.app_usage_sessions.last_seen_at))::integer)
    );

  return v_now;
end;
$$;
revoke all on function public.heartbeat_app_activity(uuid, uuid, text, text, text, text) from public, anon;
grant execute on function public.heartbeat_app_activity(uuid, uuid, text, text, text, text) to authenticated;

-- The requested cleanup is exact-domain only; lookalikes and example.test fixtures are untouched.
do $$
declare
  v_affected integer;
begin
  select count(*)::integer into v_affected
  from auth.users
  where split_part(lower(btrim(coalesce(email, ''))), '@', 2) = 'example.com';

  delete from auth.users
  where split_part(lower(btrim(coalesce(email, ''))), '@', 2) = 'example.com';

  insert into private.security_cleanup_log(action, affected_accounts)
  values ('delete_example_com_accounts', v_affected);
end;
$$;
