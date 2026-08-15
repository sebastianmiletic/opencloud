-- Older production projects predate the rich watch-history metadata columns.
alter table public.watch_history add column if not exists poster_path text;
alter table public.watch_history add column if not exists vote_average numeric(3,1) default 0;
alter table public.watch_history add column if not exists year text;
