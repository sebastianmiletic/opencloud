begin;

create extension if not exists pgtap with schema extensions;
select plan(7);

select is(
  has_function_privilege('anon', 'private.before_user_created(jsonb)', 'EXECUTE'),
  false,
  'anonymous clients cannot invoke the signup hook'
);

select is(
  private.before_user_created(jsonb_build_object('user', jsonb_build_object(
    'email', 'bot@example.com',
    'user_metadata', jsonb_build_object('opencloud_install_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  )))->'error'->>'http_code',
  '403',
  'example.com signup is rejected'
);

select is(
  private.before_user_created(jsonb_build_object('user', jsonb_build_object(
    'email', 'person@example.test', 'user_metadata', '{}'::jsonb
  )))->'error'->>'http_code',
  '400',
  'signup without an installation ID is rejected'
);

insert into private.signup_device_accounts(install_id, user_id)
select 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid, gen_random_uuid()
from generate_series(1, 5);

select is(
  private.before_user_created(jsonb_build_object('user', jsonb_build_object(
    'email', 'sixth@example.test',
    'user_metadata', jsonb_build_object('opencloud_install_id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
  )))->'error'->>'http_code',
  '429',
  'sixth account on one installation is rejected'
);

select is(
  private.before_user_created(jsonb_build_object('user', jsonb_build_object(
    'email', 'person@example.test',
    'user_metadata', jsonb_build_object('opencloud_install_id', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')
  ))),
  '{}'::jsonb,
  'ordinary signup from a fresh installation is allowed'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.app_installations'::regclass
      and contype = 'p'
      and pg_get_constraintdef(oid) = 'PRIMARY KEY (install_id, user_id)'
  ),
  'installation activity supports up to five account associations'
);

select ok(
  not exists (select 1 from auth.users where lower(email) like '%@example.com'),
  'known example.com bot accounts are absent'
);

select * from finish();
rollback;
