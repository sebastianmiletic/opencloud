# Supabase Migration: Watch History Metadata

If your `watch_history` table is missing `poster_path`, `vote_average`, and `year` columns, run this SQL in your Supabase SQL Editor:

```sql
-- Add missing columns to watch_history for poster/rating/year display
alter table watch_history add column if not exists poster_path text;
alter table watch_history add column if not exists vote_average numeric(3,1) default 0;
alter table watch_history add column if not exists year text;

-- Add unique constraint if it doesn't exist
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
    and tablename = 'watch_history'
    and indexdef like '%unique%'
  ) then
    alter table watch_history add constraint unique_user_tmdb unique(user_id, tmdb_id);
  end if;
end $$;
```

After running this, reload `http://localhost:8080` and history items will persist with posters, ratings, and years.
