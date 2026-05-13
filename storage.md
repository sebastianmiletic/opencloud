# Storage

All data is persisted to localStorage. No server-side database.

## Key Structure

| Key | Purpose |
|-----|---------|
| `openccloud_accounts` | Array of account names |
| `openccloud_current_user` | Currently active account name |
| `openccloud_user_{name}_usercollection` | Collection items for account |
| `openccloud_settings` | App settings (device, provider, autoplay) |
| `openccloud_omdb_cache` | OMDB rating cache (7-day TTL) |
| `openccloud_blocker_settings` | Blocker configuration |

## Data Format

### Collection Item
```javascript
{
  id: 12345,
  media_type: 'movie',
  title: 'Movie Name',
  year: '2023',
  poster_path: '/path.jpg',
  vote_average: 8.5,
  added_at: '2026-05-13T21:00:00.000Z'
}
```

## Helpers

- `getUserPrefix()` — returns `openccloud_user_{currentUser}`
- `getUserCollectionForUser(user)` / `saveUserCollectionForUser(user, data)` — cross-user collection access

## Cache Strategy

OMDB cache stores `{ value, timestamp }` objects. Entries older than 7 days are considered stale and refetched.
