# Sports (3.9.20)

Sports sits between Home and Collection and presents the public football schedule
from **camel1.to** in OpenCloud's existing interface. It does not open Chromium,
embed Camel's website, or execute Camel's advertising, tracking, or page scripts.
macOS uses the existing Tauri WKWebView and native HLS decoder. Other platforms
use their existing system webview and a lazily loaded, locally bundled `hls.js`
when native HLS is unavailable. No new browser shell is installed or launched.

## Behavior

- Fixtures and live scores grouped by competition, with live, upcoming, and result
  filters, team/league search, UTC schedule dates, and local kickoff times.
- A public schedule refresh every minute, only while Sports is visible. Failed
  refreshes preserve the last successful schedule with an explicit warning.
- Live streams play inline with native video controls, fullscreen, source selection,
  and retry. Matches without video are honestly labeled as score-only/not-live.
- Leaving Sports, opening another view, or closing its player cancels pending UI
  work, destroys HLS buffers, and releases the video source.
- Sports never writes movie/TV history, collection, watch progress, or account data.

## Integration and safety

`js/sports-data.js` normalizes Camel's grouped public API response and restricts
stream/image URLs. `js/sports-api.js` uses `fetch_sports` in the native Tauri build,
`/api/sports` on Render, or Camel's CORS-enabled endpoint during web development.
Both native and server routes accept only `schedule`, `streams`, and `token` and
validate their parameters. Destinations are fixed to `api.cameltv.live`; arbitrary
URLs, mutation APIs, redirects, account credentials, and auth cookies are excluded.
The existing movie-provider navigation and popup policies are unchanged. Native
HLS cannot set a per-video referrer policy, so the app document uses `no-referrer`
to prevent Camel's hotlink checks from rejecting an OpenCloud origin. Movie
iframes retain their explicit `referrerpolicy="origin"` override.

Camel's HLS endpoints require a short-lived token issued by its public `/token`
endpoint. Its response uses an AES-GCM envelope with a public compatibility key
already shipped in Camel's website client. OpenCloud decodes only that response
locally; it does not generate, forge, persist, or bypass playback authorization.
Provider rejection or unavailable streams surface as an error with retry. Tokens
are fetched afresh, are never server/service-worker cached, and are not logged.

The upstream may change its API, token format, availability, or permitted regions.
The schedule and stream parser report unsupported responses rather than inventing
fixtures or silently showing a blank embedded page.

## Verification

`npm run check` includes API/URL boundaries, real-time fixture deduplication,
zero scores, filters, public-token decoding, native HLS selection, cancelled
playback races, tab order, and the separate native sports command. Browser smoke
checks should cover loading, filtering, unavailable streams, native video controls,
phone layouts, themes, and Home/Collection/History/search navigation.

## Complete rollback

The feature and release metadata are isolated in the commit **Add Camel Sports tab
and release v3.9.20**. Revert that commit (not unrelated commits or user files),
then bump the release metadata to a version higher than the currently published
release before tagging the rollback. This removes Sports, its native command,
proxy routes, dependency, CSP additions, tests, styles, and documentation without
any account-data migration. Existing installations can also use the signed
3.9.19 release under Check for Updates > Past versions.
