-- OpenCloud requires a confirmed, non-anonymous email account for all app access.

create or replace function public.account_is_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from auth.users users
      where users.id = auth.uid()
        and users.email is not null
        and users.email_confirmed_at is not null
        and not coalesce(users.is_anonymous, false)
    )
    and coalesce((
      select access.state = 'active'
      from private.account_access access
      where access.user_id = auth.uid()
    ), true);
$$;
revoke all on function public.account_is_active() from public, anon;
grant execute on function public.account_is_active() to authenticated;

create or replace function public.get_my_access()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when auth.uid() is null or not exists (
      select 1
      from auth.users users
      where users.id = auth.uid()
        and users.email is not null
        and users.email_confirmed_at is not null
        and not coalesce(users.is_anonymous, false)
    ) then jsonb_build_object('state', 'signed_out', 'reason', '', 'isOwner', false)
    else jsonb_build_object(
      'state', coalesce(access.state, 'active'),
      'reason', coalesce(access.reason, ''),
      'isOwner', private.is_dev_owner(auth.uid())
    )
  end
  from (select 1) seed
  left join private.account_access access on access.user_id = auth.uid();
$$;
revoke all on function public.get_my_access() from public, anon;
grant execute on function public.get_my_access() to authenticated;
