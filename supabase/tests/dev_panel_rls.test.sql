begin;

create extension if not exists pgtap with schema extensions;
select plan(37);

select is(
  has_function_privilege('anon', 'public.handle_new_user()', 'EXECUTE'),
  false,
  'anonymous clients cannot invoke the auth trigger function'
);
select ok(
  not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'profiles', 'collections', 'watch_history', 'watch_progress',
        'user_settings', 'watch_sessions', 'app_installations'
      )
      and ('public' = any(roles) or 'anon' = any(roles))
  ),
  'application RLS policies apply explicitly to authenticated users only'
);

insert into auth.users(
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('11111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated',
   'owner@example.test', 'not-a-real-password', now(), '{}'::jsonb,
   '{"username":"Owner"}'::jsonb, now(), now()),
  ('22222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated',
   'user@example.test', 'not-a-real-password', now(), '{}'::jsonb,
   '{"username":"User"}'::jsonb, now(), now());

select is(
  private.provision_dev_owner('owner@example.test'),
  '11111111-1111-4111-8111-111111111111'::uuid,
  'owner is privately provisioned from a confirmed email'
);

update auth.users
set is_anonymous = true
where id = '22222222-2222-4222-8222-222222222222';

set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select is(
  public.account_is_active(),
  false,
  'anonymous auth users are not active OpenCloud accounts'
);
select is(
  public.get_my_access()->>'state',
  'signed_out',
  'anonymous auth users receive no application session access'
);
select throws_ok(
  $$select public.heartbeat_installation(
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid,
    '3.5.0', 'macos', 'aarch64'
  )$$,
  '42501',
  'Active account required',
  'anonymous auth users cannot register installations'
);

reset role;
update auth.users
set is_anonymous = false
where id = '22222222-2222-4222-8222-222222222222';

set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

select is(
  (public.get_my_access()->>'isOwner')::boolean,
  false,
  'ordinary account is not an owner'
);
select is(
  (select count(*)::integer from public.profiles),
  1,
  'ordinary account can read only its own profile'
);
select throws_ok(
  'select public.dev_summary()',
  '42501',
  'Dev access denied',
  'ordinary account cannot call Dev summary'
);
select throws_ok(
  $$select public.dev_suspend_user('11111111-1111-4111-8111-111111111111'::uuid, 'no')$$,
  '42501',
  'Dev access denied',
  'ordinary account cannot suspend users'
);
select throws_ok(
  $$select public.dev_force_sign_out('11111111-1111-4111-8111-111111111111'::uuid)$$,
  '42501', 'Dev access denied', 'ordinary account cannot force sign-out'
);
select throws_ok(
  $$select public.dev_ban_user('11111111-1111-4111-8111-111111111111'::uuid, 'no')$$,
  '42501', 'Dev access denied', 'ordinary account cannot ban users'
);

select lives_ok(
  $$select public.heartbeat_installation(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
    '3.5.0', 'macos', 'aarch64'
  )$$,
  'ordinary active account can heartbeat its own installation'
);
select lives_ok(
  $$select public.heartbeat_app_activity(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid,
    '3.6.0', 'macos', 'aarch64', 'laptop'
  )$$,
  'ordinary account can record privacy-bounded app activity'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

select is(
  (public.get_my_access()->>'isOwner')::boolean,
  true,
  'provisioned owner receives owner access'
);
select ok(
  exists (
    select 1
    from jsonb_array_elements(public.dev_list_users('', 'all', 100, 0)->'users') as listed(user_row)
    where user_row->>'id' = '11111111-1111-4111-8111-111111111111'
      and (user_row->>'is_owner')::boolean
  ),
  'owner row is explicitly labeled for self-protection in the Dev workspace'
);
select throws_ok(
  $$select public.heartbeat_installation(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
    '3.5.0', 'macos', 'aarch64'
  )$$,
  '42501',
  'Installation ID belongs to another account',
  'an installation ID cannot be reassigned to a different account'
);
select throws_ok(
  $$select public.dev_force_sign_out('11111111-1111-4111-8111-111111111111'::uuid)$$,
  '42501', 'The owner account cannot be signed out remotely',
  'owner cannot force sign-out itself'
);
select throws_ok(
  $$select public.dev_ban_user('11111111-1111-4111-8111-111111111111'::uuid, 'no')$$,
  '42501', 'The owner account cannot be banned', 'owner cannot ban itself'
);
select is(
  (select listed.user_row->>'latest_device_kind'
   from jsonb_array_elements(public.dev_list_users('', 'all', 100, 0)->'users') listed(user_row)
   where listed.user_row->>'id' = '22222222-2222-4222-8222-222222222222'),
  'laptop', 'owner sees device layout metadata'
);
select is(
  (public.dev_user_detail('22222222-2222-4222-8222-222222222222'::uuid)->'stats'->>'appSessions')::integer,
  1, 'owner sees app session analytics'
);
select is(
  (public.dev_summary()->>'accounts')::integer,
  2,
  'owner summary counts auth accounts'
);
select is(
  (public.dev_summary()->>'installations')::integer,
  1,
  'owner summary counts signed-in installations'
);
select is(
  (public.dev_list_users('', 'all', 100, 0)->>'total')::integer,
  2,
  'owner can list both accounts through the restricted RPC'
);
select throws_ok(
  $$select public.dev_suspend_user('11111111-1111-4111-8111-111111111111'::uuid, 'no')$$,
  '42501',
  'The owner account cannot be suspended',
  'owner cannot suspend the owner account'
);

reset role;
insert into auth.sessions(id, user_id, created_at, updated_at)
values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '22222222-2222-4222-8222-222222222222',
  now(), now()
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select lives_ok(
  $$select public.dev_suspend_user(
    '22222222-2222-4222-8222-222222222222'::uuid,
    'Security review'
  )$$,
  'owner can suspend an ordinary account'
);

reset role;
select is(
  (select count(*)::integer from auth.sessions where user_id = '22222222-2222-4222-8222-222222222222'),
  0,
  'suspension deletes active auth sessions'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select is(
  public.get_my_access()->>'state',
  'suspended',
  'suspended account receives suspended state'
);
select is(
  public.account_is_active(),
  false,
  'suspended account is denied at the RLS boundary'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select lives_ok(
  $$select public.dev_restore_user('22222222-2222-4222-8222-222222222222'::uuid)$$,
  'owner can restore a suspended account'
);
select is(
  jsonb_array_length(public.dev_user_detail('22222222-2222-4222-8222-222222222222'::uuid)->'audit'),
  2,
  'suspend and restore actions are audited'
);

reset role;
insert into auth.sessions(id, user_id, created_at, updated_at)
values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '22222222-2222-4222-8222-222222222222', now(), now());
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select lives_ok(
  $$select public.dev_force_sign_out('22222222-2222-4222-8222-222222222222'::uuid)$$,
  'force sign-out is a separate working action'
);
reset role;
select is(
  (select count(*)::integer from auth.sessions where user_id = '22222222-2222-4222-8222-222222222222'),
  0, 'force sign-out revokes sessions without changing access'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select lives_ok(
  $$select public.dev_ban_user('22222222-2222-4222-8222-222222222222'::uuid, 'Abuse')$$,
  'owner can ban an ordinary account'
);
select is(
  public.get_my_access()->>'state',
  'active',
  'owner remains active after banning another account'
);
select lives_ok(
  $$select public.dev_restore_user('22222222-2222-4222-8222-222222222222'::uuid)$$,
  'owner can restore a banned account'
);
select is(
  jsonb_array_length(public.dev_user_detail('22222222-2222-4222-8222-222222222222'::uuid)->'audit'),
  5, 'all separate access actions are audited'
);

select * from finish();
rollback;
