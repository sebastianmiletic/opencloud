# Sports (3.9.21)

Sports sits between Home and Collection. Its Football screen uses the public
**camel1.to** schedule, scores and streams, not an embedded copy of the website.
It never opens a separate Chromium browser or executes Camel's advertising,
tracking or page scripts. macOS uses the existing WKWebView and native HLS
decoder. Other platforms use their existing webview and a lazily loaded,
locally bundled `hls.js` when native HLS is unavailable.

## Main football only

The list includes recognized senior international competitions, major domestic
leagues and national cups. The explicit competition allowlist and international
competition patterns live in `isMainFootballMatch()` in `js/sports-data.js`.
Examples include the Premier League, La Liga, Bundesliga, Serie A, Ligue 1,
Champions League, Nations League, World Cup qualifiers, major national cups,
MLS and the A-League. Selected major senior women's competitions are included.

Both team names and competition names are checked for U-age groups, youth,
junior, reserve, academy and development labels. Reserve teams such as Benfica B
and Ajax II are excluded even if they appear in a senior competition's feed.
Unrecognized/lower-profile competitions remain hidden. Camel's highlighted
fixtures affect ordering, not admission to this senior-only list. There is no
synthetic fallback schedule, hard-coded match list, estimated score or guessed
match clock. Missing scores stay missing; incomplete team/competition records
are omitted instead of becoming invented "Home team" fixtures.

## Interface and freshness

- Quiet competition lists, real scores, team/competition search, Yesterday,
  Today and Tomorrow shortcuts, a UTC date picker, and local kickoff times.
- Live, upcoming and results filters. No disabled watch buttons on every row.
- The schedule refreshes every minute only while Sports is visible. "Checked"
  means the time of the successful fetch, not a fabricated provider update time.
- Failed refreshes retain the last successful data with a connection warning.
  Cached live fixtures say **Last reported**, not **Live**, until a fetch succeeds.
- Watch is offered only for a currently reported live, unblocked match with
  provider-reported video coverage. That flag is not a guarantee of delivery.
  The stream list and authorization are fetched afresh when opening the player.

## Playback

- Actual HLS video plays inline with native controls and fullscreen.
- Playback starts muted to respect autoplay policies. **Sound off/on** controls
  audio explicitly; a large Play button appears if autoplay is blocked or paused.
- Available HD sources are preferred. Sources are numbered independently; no
  commentary language is invented from an opaque stream identifier.
- Failed starts automatically try another allowlisted source. Token rejection
  gets one fresh authorization attempt before failover. HLS decoder recovery is
  bounded, and frozen playback is detected from actual video-time progression.
- Authorization is renewed before the provider's token expires. Renewal can
  briefly reconnect the video. An intentionally paused feed stays paused; its
  next resume obtains fresh authorization if needed.
- If every feed is unavailable, the player reports that honestly and provides
  Try again. It does not substitute a different match or simulate playing video.
- Leaving Sports, closing its player or opening another view cancels pending
  work, clears startup/renewal/watchdog timers, destroys HLS buffers and releases
  the video source. Sports never writes movie/TV history, collections, account
  settings or saved progress.

## Integration and safety

`js/sports-api.js` uses `fetch_sports` in Tauri, `/api/sports` on Render, or Camel's
CORS-enabled endpoint during development. Native/server routes accept only
`schedule`, `streams` and `token`, with validated parameters and fixed
`api.cameltv.live` destinations. Arbitrary URLs, mutations, redirects, account
credentials and auth cookies are excluded. Stream and logo URLs are allowlisted.

Native HLS cannot set a per-video referrer policy, so the document uses
`no-referrer` to avoid Camel's hotlink rejection of the OpenCloud origin.
Movie iframes preserve their explicit `referrerpolicy="origin"` override.
Existing movie-provider navigation and popup policies are unchanged.

Playback tokens come from Camel's public `/token` endpoint. OpenCloud decodes
its AES-GCM response envelope using the compatibility key shipped in Camel's
public client. It does not generate, forge, persist or bypass authorization.
Tokens are fetched afresh and never server/service-worker cached or logged.
The upstream can change its API, token format, regions or availability. No client
can guarantee a working feed when the provider is offline or rejects the viewer.

## Verification and publishing

`npm run check` covers senior filtering, malformed/missing data, URL/API
boundaries, genuine zero scores, token decoding, native and lazy HLS playback,
automatic failover, decoder/token recovery, expired-token renewal, user pause,
stalled video, cancellation and cleanup. Browser smoke checks use real Camel
fixtures and real Render API requests; test-only failure injection exercises
fallback/error states without adding sample fixtures to production.

Check phone layouts, themes, sound, play/pause, fullscreen and other app views.
Exercise both native HLS and HLS.js with actual video frames/time progression,
not just a successful playlist request or a "playing" status label.

**Render tracks `render-web`, not `main`.** After validation, fast-forward both
branches to the same commit. See [Render deployment](render-web.md). Desktop
installers and the signed updater are published by the `v3.9.21` release tag.

## Complete rollback

The original feature is isolated in `ee6a526` (**Add Camel Sports tab and release
v3.9.20**). The refinement is isolated in **Clean up senior football and harden
sports playback; release v3.9.21**. Revert the refinement to restore the earlier
Sports behavior. To remove Sports completely, revert the refinement and then
`ee6a526`, preserving unrelated commits/files, and publish a version higher than
the latest released version. Fast-forward `render-web` as well. Do not reuse an
old release tag. No account-data migration or cleanup is needed. Existing native
installations can also select the signed 3.9.19 release under Past versions.
