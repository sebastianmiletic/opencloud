# API Integration

Open Cloud uses two external APIs: **TMDB** for movie/TV data and **OMDB** for IMDb ratings.

## TMDB (The Movie Database)

### Authentication
TMDB uses a Bearer token passed in the `Authorization` header. The token is read from `.env` via `/env.js`.

### Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `/search/multi` | Global search (movies + TV) |
| `/search/movie` | Movie search |
| `/search/tv` | TV search |
| `/movie/popular` | Popular movies |
| `/movie/now_playing` | Now playing |
| `/movie/top_rated` | Top rated |
| `/discover/movie` | Genre-filtered discovery |
| `/movie/{id}` | Movie details |
| `/tv/{id}` | TV show details |
| `/tv/{id}/season/{n}` | Season episodes |
| `/collection/10` | Star Wars collection |

### Data Format
All TMDB responses include `id`, `title`/`name`, `poster_path`, `backdrop_path`, `overview`, `vote_average`, and date fields. Images are served from `https://image.tmdb.org/t/p/`.

## OMDB (Open Movie Database)

### Authentication
OMDB uses an API key passed as `?apikey=` query parameter. The key is read from `.env` via `/env.js`.

### Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `?t={title}&y={year}&apikey={key}` | Get IMDb rating for a title |

### Caching
OMDB responses are cached in localStorage for 7 days under `openccloud_omdb_cache` to avoid rate limits.

### Batch Fetching
`getOMDBRatingsBatch(items)` fetches ratings for multiple items concurrently using `Promise.all`.

## Rate Limits

- **TMDB**: 40 requests per 10 seconds ( generous for this app )
- **OMDB**: 1,000 free daily requests (cached to stay well under limit)

## Error Handling

All API calls are wrapped in try/catch. On failure:
- Search shows "Search failed" message
- Categories show "Failed to load"
- Player shows "Error loading video"
- Hero and recommendations gracefully hide if data is unavailable
