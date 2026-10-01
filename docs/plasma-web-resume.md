# Plasma browser playback-position integration

## What was missing

Plasma (`vsembed`) did not lack a playback API. Its nested CloudOrchestra player
emits a VidAPI-compatible `PLAYER_EVENT`, relayed to the embedding application
by the outer `https://vsembed.ru` iframe. OpenCloud's earlier browser adapter
expected `currentTime`, `duration`, and `event`; Plasma instead provides:

```js
{
  type: 'PLAYER_EVENT',
  data: {
    player_info: { tmdb: '550', mediaType: 'movie', season: null, episode: null },
    player_status: 'playing',
    player_progress: 326.4,
    player_duration: 8348
  }
}
```

The status values are `playing`, `paused`, `seeked`, and `completed`. `playing`
reports are emitted about every five seconds. The provider also accepts
`startAt` (or its `resumeAt` alias); its wrappers carry that value through to the
actual media player's configuration for both movie and explicit TV routes.

## Change

`js/provider-playback.js` now normalizes this protocol for Plasma. It validates
the current outer iframe's source and exact origin, TMDB identity, media type,
and individual TV episode. All events require fresh numeric progress/duration;
malformed events and short advertisement/startup samples cannot reuse an older
sample. Untrusted messages sent directly from another nested frame are rejected.

The existing `js/player.js` persistence and lifecycle code saves these samples
locally and synchronizes account progress. It appends the saved `startAt` when
reopening Plasma. It does not read a cross-origin video DOM, inject scripts into
browser embeds, replace Plasma's source chain, or estimate video time from wall
clock time. Existing native Tauri telemetry remains authoritative on desktop.

No provider defaults, settings migrations, collections, history or credentials
are changed. No unrelated product-review suggestions are implemented.

## Verification

- JavaScript regression coverage includes Plasma status normalization, wrong
  origins/iframe generations, wrong title/type/episode, malformed numeric data,
  short ads, close/page-exit/pause persistence, reload/cloud reconciliation,
  account isolation, backwards seeks, and native-bridge deduplication.
- HTTP checks confirmed `startAt=321.4` reaches the final player configuration
  for `/embed/movie/550` and `/embed/tv/1399/1/2`. This alone is not playback proof.
- Real Chromium/Brave embed tests clicked the ordinary provider Play control,
  received relayed events from `https://vsembed.ru`, and observed both a movie
  and TV episode starting at 321.4 seconds, then advancing to 326.4 seconds.
- A browser harness using the full, unmodified OpenCloud player/storage modules
  and real Plasma media playback saved movie 550 at 326.4 seconds on close.
  After a page reload, the generated URL included that checkpoint and actual
  playback restarted at 326.4 seconds, then advanced.
- The full harness also left the site while TV 1399 S1E2 was playing. Reopening
  recovered its latest observed 216.7-second checkpoint, requested the same
  episode and actually resumed at 216.7 seconds, then advanced. Authentication,
  catalog and cloud network dependencies used a synthetic isolated account;
  the provider and media requests were real. This is not a claim that a real
  Supabase login session or every production browser/device has been tested.

## Limits and follow-up

The latest available position is limited by the provider's event frequency.
OpenCloud checkpoints locally every ten seconds during regular playback, with
forced saves on pause/seek/player-close/page-hide/site-exit. Abrupt OS/browser
termination can lose updates since the last durable local checkpoint. Cloud
requests at exit are best effort; the next startup reconciles local progress.

Browser autoplay restrictions still apply. Restoring the position does not
bypass the provider's Play button or promise automatic audible playback. A
transient provider startup failure occurred on one full-harness reopen attempt;
a repeat completed successfully. The integration does not fix every provider
network/startup failure or promise zero buffering.

Provider protocols and delivery hosts can change. Recheck actual event payloads
and media playback before broadening trusted origins. OpenCloud's episode
controls use explicit episode URLs; events for a different episode are rejected
rather than assigned to the wrong checkpoint. A broader provider-native episode
navigation integration remains separate work.

Public interface references: [VidAPI documentation](https://vidapi.ru/api),
Plasma's `/embed/movie/...` and `/vs_src.php` wrapper, and CloudOrchestra's
public `/embed/iframe_player/assets/player.js`. Do not commit gate tokens,
signed media URLs or captured provider pages to the repository.
