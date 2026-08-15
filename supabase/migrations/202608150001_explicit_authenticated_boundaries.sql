-- Make authentication boundaries explicit for the database security advisor.

revoke all on function public.handle_new_user() from public, anon, authenticated;

drop policy if exists "Users can read own installations" on public.app_installations;
create policy "Users can read own installations"
  on public.app_installations for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id and public.account_is_active());

drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id and public.account_is_active());

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id and public.account_is_active())
  with check (auth.uid() = id and public.account_is_active());

drop policy if exists "Users can manage own collections" on public.collections;
create policy "Users can manage own collections" on public.collections
  for all to authenticated
  using (auth.uid() = user_id and public.account_is_active())
  with check (auth.uid() = user_id and public.account_is_active());

drop policy if exists "Users can manage own history" on public.watch_history;
create policy "Users can manage own history" on public.watch_history
  for all to authenticated
  using (auth.uid() = user_id and public.account_is_active())
  with check (auth.uid() = user_id and public.account_is_active());

drop policy if exists "Users can manage own progress" on public.watch_progress;
create policy "Users can manage own progress" on public.watch_progress
  for all to authenticated
  using (auth.uid() = user_id and public.account_is_active())
  with check (auth.uid() = user_id and public.account_is_active());

drop policy if exists "Users can manage own settings" on public.user_settings;
create policy "Users can manage own settings" on public.user_settings
  for all to authenticated
  using (auth.uid() = user_id and public.account_is_active())
  with check (auth.uid() = user_id and public.account_is_active());

drop policy if exists "Users can manage own sessions" on public.watch_sessions;
create policy "Users can manage own sessions" on public.watch_sessions
  for all to authenticated
  using (auth.uid() = user_id and public.account_is_active())
  with check (auth.uid() = user_id and public.account_is_active());
