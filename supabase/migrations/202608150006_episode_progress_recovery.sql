-- Preserve exact per-episode checkpoints instead of storing only the latest episode.
alter table public.watch_progress add column if not exists duration_seconds integer default 0;
alter table public.watch_progress add column if not exists episode_progress jsonb not null default '{}'::jsonb;
