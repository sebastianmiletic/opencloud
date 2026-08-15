-- Owner-only activity analytics, device metadata, and distinct account controls.

alter table public.app_installations
  add column if not exists device_kind text not null default 'laptop';

alter table private.account_access
  drop constraint if exists account_access_state_check;
alter table private.account_access
  add constraint account_access_state_check check (state in ('active', 'suspended', 'banned'));

alter table private.dev_audit_log
  drop constraint if exists dev_audit_log_action_check;
alter table private.dev_audit_log
  add constraint dev_audit_log_action_check
  check (action in ('force_sign_out', 'suspend', 'ban', 'restore'));

create table if not exists public.app_usage_sessions (
  session_id uuid primary key,
  install_id uuid not null references public.app_installations(install_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  active_seconds bigint not null default 0 check (active_seconds >= 0)
);
create index if not exists app_usage_sessions_user_idx
  on public.app_usage_sessions(user_id, last_seen_at desc);
alter table public.app_usage_sessions enable row level security;
revoke all on public.app_usage_sessions from public, anon, authenticated;

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
    select 1 from public.app_installations
    where install_id = p_install_id and user_id <> auth.uid()
  ) then
    raise exception 'Installation ID belongs to another account' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.app_usage_sessions
    where session_id = p_session_id and user_id <> auth.uid()
  ) then
    raise exception 'Session ID belongs to another account' using errcode = '42501';
  end if;

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
  on conflict (install_id) do update set
    user_id = auth.uid(), app_version = excluded.app_version,
    platform = excluded.platform, architecture = excluded.architecture,
    device_kind = excluded.device_kind, last_seen_at = v_now;

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

create or replace function public.dev_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  perform private.assert_dev_owner();
  select jsonb_build_object(
    'accounts', (select count(*) from auth.users),
    'installations', (select count(*) from public.app_installations),
    'onlineUsers', (select count(distinct user_id) from public.app_installations where last_seen_at >= now() - interval '2 minutes'),
    'onlineInstallations', (select count(*) from public.app_installations where last_seen_at >= now() - interval '2 minutes'),
    'suspended', (select count(*) from private.account_access where state = 'suspended'),
    'banned', (select count(*) from private.account_access where state = 'banned'),
    'generatedAt', now()
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.dev_list_users(
  p_query text default '', p_status text default 'all',
  p_limit integer default 100, p_offset integer default 0
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_query text := lower(btrim(coalesce(p_query, '')));
  v_status text := lower(btrim(coalesce(p_status, 'all')));
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 200));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_result jsonb;
begin
  perform private.assert_dev_owner();
  if v_status not in ('all', 'online', 'offline', 'suspended', 'banned') then
    raise exception 'Invalid status filter' using errcode = '22023';
  end if;
  with user_rows as (
    select users.id,
      coalesce(profiles.username, split_part(users.email, '@', 1), 'User') username,
      users.email, users.created_at joined_at,
      coalesce(access.state, 'active') access_state,
      coalesce(access.reason, '') access_reason,
      private.is_dev_owner(users.id) is_owner,
      installs.installation_count, installs.last_seen_at, installs.latest_version,
      installs.latest_platform, installs.latest_architecture, installs.latest_device_kind,
      coalesce(installs.last_seen_at >= now() - interval '2 minutes', false) is_online
    from auth.users users
    left join public.profiles profiles on profiles.id = users.id
    left join private.account_access access on access.user_id = users.id
    left join lateral (
      select count(*)::integer installation_count, max(i.last_seen_at) last_seen_at,
        (array_agg(i.app_version order by i.last_seen_at desc))[1] latest_version,
        (array_agg(i.platform order by i.last_seen_at desc))[1] latest_platform,
        (array_agg(i.architecture order by i.last_seen_at desc))[1] latest_architecture,
        (array_agg(i.device_kind order by i.last_seen_at desc))[1] latest_device_kind
      from public.app_installations i where i.user_id = users.id
    ) installs on true
    where v_query = '' or lower(coalesce(users.email, '')) like '%' || v_query || '%'
      or lower(coalesce(profiles.username, '')) like '%' || v_query || '%'
  ), filtered as (
    select * from user_rows where v_status = 'all'
      or (v_status = 'online' and is_online)
      or (v_status = 'offline' and not is_online and access_state = 'active')
      or access_state = v_status
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'users', coalesce((select jsonb_agg(to_jsonb(page) order by page.joined_at desc)
      from (select * from filtered order by joined_at desc limit v_limit offset v_offset) page), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.dev_user_detail(p_user_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_result jsonb;
begin
  perform private.assert_dev_owner();
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'User not found' using errcode = 'P0002';
  end if;
  select jsonb_build_object(
    'stats', jsonb_build_object(
      'appActiveSeconds', coalesce((select sum(active_seconds) from public.app_usage_sessions where user_id = p_user_id), 0),
      'appSessions', (select count(*) from public.app_usage_sessions where user_id = p_user_id),
      'watchSeconds', coalesce((select sum(duration_seconds) from public.watch_sessions where user_id = p_user_id), 0),
      'watchSessions', (select count(*) from public.watch_sessions where user_id = p_user_id),
      'watchedTitles', (select count(distinct tmdb_id) from public.watch_history where user_id = p_user_id),
      'watchDays', (select count(distinct started_at::date) from public.watch_sessions where user_id = p_user_id),
      'collectionItems', (select count(*) from public.collections where user_id = p_user_id)
    ),
    'installations', coalesce((select jsonb_agg(jsonb_build_object(
      'installId', i.install_id, 'appVersion', i.app_version, 'platform', i.platform,
      'architecture', i.architecture, 'deviceKind', i.device_kind,
      'firstSeenAt', i.first_seen_at, 'lastSeenAt', i.last_seen_at,
      'isOnline', i.last_seen_at >= now() - interval '2 minutes'
    ) order by i.last_seen_at desc) from public.app_installations i where i.user_id = p_user_id), '[]'::jsonb),
    'recentViewing', coalesce((select jsonb_agg(jsonb_build_object(
      'title', h.title, 'mediaType', h.media_type, 'season', h.season,
      'episode', h.episode, 'durationSeconds', h.duration_watched, 'watchedAt', h.watched_at
    ) order by h.watched_at desc) from (select * from public.watch_history where user_id = p_user_id order by watched_at desc limit 50) h), '[]'::jsonb),
    'recentSessions', coalesce((select jsonb_agg(jsonb_build_object(
      'title', s.title, 'mediaType', s.media_type, 'season', s.season,
      'episode', s.episode, 'startedAt', s.started_at, 'endedAt', s.ended_at,
      'durationSeconds', s.duration_seconds
    ) order by s.started_at desc) from (select * from public.watch_sessions where user_id = p_user_id order by started_at desc limit 50) s), '[]'::jsonb),
    'audit', coalesce((select jsonb_agg(jsonb_build_object(
      'id', a.id, 'action', a.action, 'reason', a.reason, 'createdAt', a.created_at
    ) order by a.created_at desc) from (select * from private.dev_audit_log where target_user_id = p_user_id order by created_at desc limit 50) a), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.dev_force_sign_out(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_audit_id bigint;
begin
  perform private.assert_dev_owner();
  if p_user_id is null or not exists (select 1 from auth.users where id = p_user_id) then raise exception 'User not found' using errcode = 'P0002'; end if;
  if p_user_id = auth.uid() or private.is_dev_owner(p_user_id) then raise exception 'The owner account cannot be signed out remotely' using errcode = '42501'; end if;
  delete from auth.sessions where user_id = p_user_id;
  insert into private.dev_audit_log(actor_user_id, target_user_id, action, reason)
    values (auth.uid(), p_user_id, 'force_sign_out', '') returning id into v_audit_id;
  return jsonb_build_object('userId', p_user_id, 'state', 'active', 'auditId', v_audit_id);
end;
$$;
revoke all on function public.dev_force_sign_out(uuid) from public, anon;
grant execute on function public.dev_force_sign_out(uuid) to authenticated;

create or replace function public.dev_suspend_user(p_user_id uuid, p_reason text default '')
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_reason text := left(btrim(coalesce(p_reason, '')), 500); v_audit_id bigint;
begin
  perform private.assert_dev_owner();
  if p_user_id is null or not exists (select 1 from auth.users where id = p_user_id) then raise exception 'User not found' using errcode = 'P0002'; end if;
  if p_user_id = auth.uid() or private.is_dev_owner(p_user_id) then raise exception 'The owner account cannot be suspended' using errcode = '42501'; end if;
  insert into private.account_access(user_id, state, reason, changed_at, changed_by)
    values (p_user_id, 'suspended', v_reason, now(), auth.uid())
    on conflict (user_id) do update set state = 'suspended', reason = excluded.reason, changed_at = excluded.changed_at, changed_by = excluded.changed_by;
  update public.profiles set is_banned = false, ban_reason = '', last_seen_at = null where id = p_user_id;
  delete from auth.sessions where user_id = p_user_id;
  insert into private.dev_audit_log(actor_user_id, target_user_id, action, reason)
    values (auth.uid(), p_user_id, 'suspend', v_reason) returning id into v_audit_id;
  return jsonb_build_object('userId', p_user_id, 'state', 'suspended', 'auditId', v_audit_id);
end;
$$;

create or replace function public.dev_ban_user(p_user_id uuid, p_reason text default '')
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_reason text := left(btrim(coalesce(p_reason, '')), 500); v_audit_id bigint;
begin
  perform private.assert_dev_owner();
  if p_user_id is null or not exists (select 1 from auth.users where id = p_user_id) then raise exception 'User not found' using errcode = 'P0002'; end if;
  if p_user_id = auth.uid() or private.is_dev_owner(p_user_id) then raise exception 'The owner account cannot be banned' using errcode = '42501'; end if;
  insert into private.account_access(user_id, state, reason, changed_at, changed_by)
    values (p_user_id, 'banned', v_reason, now(), auth.uid())
    on conflict (user_id) do update set state = 'banned', reason = excluded.reason, changed_at = excluded.changed_at, changed_by = excluded.changed_by;
  update public.profiles set is_banned = true, ban_reason = v_reason, last_seen_at = null where id = p_user_id;
  delete from auth.sessions where user_id = p_user_id;
  insert into private.dev_audit_log(actor_user_id, target_user_id, action, reason)
    values (auth.uid(), p_user_id, 'ban', v_reason) returning id into v_audit_id;
  return jsonb_build_object('userId', p_user_id, 'state', 'banned', 'auditId', v_audit_id);
end;
$$;
revoke all on function public.dev_ban_user(uuid, text) from public, anon;
grant execute on function public.dev_ban_user(uuid, text) to authenticated;

-- Restore covers both a suspension and a ban.
create or replace function public.dev_restore_user(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_audit_id bigint;
begin
  perform private.assert_dev_owner();
  if p_user_id is null or not exists (select 1 from auth.users where id = p_user_id) then raise exception 'User not found' using errcode = 'P0002'; end if;
  if p_user_id = auth.uid() or private.is_dev_owner(p_user_id) then raise exception 'The owner account does not require restoration' using errcode = '42501'; end if;
  insert into private.account_access(user_id, state, reason, changed_at, changed_by)
    values (p_user_id, 'active', '', now(), auth.uid())
    on conflict (user_id) do update set state = 'active', reason = '', changed_at = excluded.changed_at, changed_by = excluded.changed_by;
  update public.profiles set is_banned = false, ban_reason = '' where id = p_user_id;
  insert into private.dev_audit_log(actor_user_id, target_user_id, action, reason)
    values (auth.uid(), p_user_id, 'restore', '') returning id into v_audit_id;
  return jsonb_build_object('userId', p_user_id, 'state', 'active', 'auditId', v_audit_id);
end;
$$;

revoke all on function public.dev_summary() from public, anon;
revoke all on function public.dev_list_users(text, text, integer, integer) from public, anon;
revoke all on function public.dev_user_detail(uuid) from public, anon;
grant execute on function public.dev_summary() to authenticated;
grant execute on function public.dev_list_users(text, text, integer, integer) to authenticated;
grant execute on function public.dev_user_detail(uuid) to authenticated;
