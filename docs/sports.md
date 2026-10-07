# Live Games (3.9.22)

Football is part of **Home**, immediately below Continue Watching. There is no
Sports navigation tab or standalone Sports page. The section uses the public
**camel1.to** schedule, scores, and streams in OpenCloud's own interface; it does
not embed Camel, open a separate Chromium browser, or execute Camel's advertising,
tracking, or page scripts.

The desktop app uses its existing native webview. macOS uses WKWebView's native
HLS decoder; platforms without native HLS support lazily load the locally bundled
`hls.js` implementation.

## Home interface

- A compact left pane shows currently live main matches, real reported scores,
  state, and a Watch action only when Camel reports usable video coverage.
- Upcoming matches run horizontally across the remaining space in chronological
  order. Home routinely loads today and tomorrow; a fixture found in the extended
  search window is brought into the lane when selected. Times use the viewer's
  locale and match-day labels follow Camel's UTC schedule dates.
- The section refreshes once per minute only while Home is visible. The refresh
  control can request an immediate update.
- Failed partial refreshes keep successful fixtures and say that some data is
  unavailable. Fully failed refreshes preserve the last successful list. Cached
  live fixtures say **Last reported**, not **Live**.
- Selecting a live result from global search returns to Home and starts its real
  feed when available. Selecting an upcoming result returns to and focuses that
  fixture in the horizontal lane.

## Global game search

The existing search bar now searches TMDB titles and Camel fixtures concurrently.
Game results appear first in the suggestion panel and in a dedicated **Games**
row on the full results page.

Search covers provider-supplied team names, competition names, and country-group
names for today through the next two UTC match days. Comparison words are ignored,
so `India Women vs Russia Women`, `India Women versus Russia Women`, and the same
team names without a separator resolve consistently. Results remain real Camel
fixtures; OpenCloud does not manufacture a match when no game matches the query.
Only live and upcoming games appear in global search.

## Main football only

The list includes recognized senior international competitions, major domestic
leagues, and national cups. The explicit competition allowlist and international
competition patterns live in `isMainFootballMatch()` in `js/sports-data.js`.
Examples include the Premier League, La Liga, Bundesliga, Serie A, Ligue 1,
Champions League, Nations League, World Cup qualifiers, major national cups,
MLS, and the A-League. Selected major senior women's competitions are included.

Both team names and competition names are checked for U-age groups, youth,
junior, reserve, academy, development, amateur, school, futsal, and beach labels.
Reserve teams such as Benfica B and Ajax II are excluded even when they appear
in a senior competition feed. Camel's highlighted fixtures affect ordering, not
eligibility. There is no synthetic fallback schedule, estimated score, guessed
clock, or hard-coded production match. Missing scores stay missing and incomplete
team/competition records are omitted.

## Playback

- Actual HLS video plays inline on Home with native controls and fullscreen.
- Playback starts muted for reliable autoplay. **Sound off/on** explicitly changes
  audio; a large Play button appears when autoplay is blocked or the user pauses.
- Available HD sources are preferred. Sources are numbered without inventing a
  commentary language from opaque provider identifiers.
- A failed start automatically tries another allowlisted source. Token rejection
  gets one fresh authorization attempt before failover. Decoder recovery and
  frozen-video recovery are bounded.
- Authorization renews shortly before provider token expiry. A deliberate pause
  stays paused, and resuming obtains fresh authorization when required.
- If all feeds fail, the player says so and offers **Try again**. It never swaps in
  a different match or simulates playback.
- Closing the player, opening another app view, launching movie/TV playback,
  hiding the page, or leaving the app cancels pending work, clears timers,
  destroys HLS buffers, and releases the video source.
- Games never write movie/TV history, collections, account settings, or progress.

## Integration and safety

`js/sports-api.js` uses `fetch_sports` in Tauri, `/api/sports` on Render, or
Camel's CORS-enabled endpoint during development. Native/server routes accept
only `schedule`, `streams`, and `token`, with validated parameters and fixed
`api.cameltv.live` destinations. Arbitrary URLs, mutations, redirects, account
credentials, and auth cookies are excluded. Stream and logo URLs are allowlisted.

Native HLS cannot set a per-video referrer policy, so the document uses
`no-referrer` to avoid Camel's hotlink rejection of the OpenCloud origin. Movie
iframes retain their explicit `referrerpolicy="origin"` override. Existing movie
provider navigation and popup policies are unchanged.

Playback tokens come from Camel's public `/token` endpoint. OpenCloud decodes its
AES-GCM response envelope with the compatibility key shipped in Camel's public
client. It does not generate, forge, persist, cache, log, or bypass authorization.
Camel can change its API, token format, geography, or availability; OpenCloud
cannot guarantee a feed that the upstream provider does not deliver.

## Verification and publishing

`npm run check` covers the Home placement and absence of a Sports tab, search
separator/country behavior, senior filtering, malformed data, URL/API boundaries,
genuine zero scores, token decoding, native/lazy HLS playback, source failover,
decoder/token recovery, renewal, deliberate pause, stalled video, cancellation,
and cleanup.

Browser smoke tests use real Camel fixtures and real Render API requests. Verify
desktop and phone layouts, all themes, keyboard focus, search suggestions/full
results, sound, pause/resume, fullscreen, cleanup, and both native HLS and HLS.js
with actual frame dimensions and advancing video time—not only a playlist request
or status label.

**Render tracks `render-web`, not `main`.** After validation, fast-forward both
branches to the same commit. See [Render deployment](render-web.md). Desktop
installers and signed updater metadata are published by the `v3.9.22` release tag.

## Rollback

The v3.9.22 change is presentation-only around the existing Sports integration:
reverting it restores the v3.9.21 standalone Sports tab and page. The hardened
senior-only integration is isolated in `75469de` (v3.9.21), and the original
feature in `ee6a526` (v3.9.20). Revert those in reverse order only if Camel
football should be removed completely. Preserve unrelated files, publish a
version newer than the latest release, and fast-forward `render-web`; never reuse
an old tag. No account-data migration or cleanup is required.
