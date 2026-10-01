# Website and desktop review

**Suggestions only. None of the additions below are implemented by the browser
resume fix.** This is a source/flow review, not a complete live accessibility,
security or performance audit. The cinematic, restrained interface should stay
focused on finding and continuing content, not become a dashboard.

## Prioritize reliability

1. **Collision-safe progress identity (both).** `js/storage.js` keys progress by
   TMDB ID alone; `js/sync.js` upserts on `user_id,tmdb_id`, also reflected in
   `docs/supabase_schema.sql`. Movie and TV IDs occupy separate namespaces, so a
   numeric collision can mix their checkpoints. A future change should key by
   type plus ID, with a backed-up, lossless database/local-cache migration and
   explicit compatibility handling for old desktop versions. Do not casually
   replace existing rows or collections.
2. **Visible durable/cloud save state (both).** Show a quiet “Saved on this
   device”, “Synced”, or “Waiting for connection” status, based on confirmed
   writes rather than a timer. Add retry/reconciliation tests for network loss,
   browser termination, token expiry, two devices and account switches. The
   current resume fix preserves local checkpoints, but it does not add a sync
   status surface or guarantee completion of an exit-time cloud request.
3. **Provider capability and runtime compatibility matrix (both).** Track
   progress messages, seek/resume, autoplay, internal episode navigation,
   subtitles and supported browser/WebView separately. Availability of HTML is
   not successful playback. The resume fix only labels web progress API
   availability; a broader compatibility system is still a suggestion. Test
   authenticated full-app playback on Intel/Apple Silicon, Windows/Linux,
   Safari/Chromium, and mobile, with affected titles and selected servers.
4. **Sanitized playback diagnostics (both).** An optional copy/export action
   could report app/browser/OS version, title/episode, selected provider,
   observed startup/seek/end state and errors. Strip stream URLs, signed query
   strings, account/session tokens and catalog credentials. This would make
   Platinum-style user reports reproducible without exposing secrets.

## Make continuing clearer

5. **Movies in Continue Watching (both).** `loadContinueWatching()` in
   `js/ui.js` currently filters for season and episode and fetches TV metadata.
   Include incomplete movies, progress indicators and a concise saved-time
   label. Offer “Resume” and explicit “Start over”, plus removal from the row
   without deleting account history. Movie reopening now resumes through the
   player, but this review does not implement movie cards or reset controls.
6. **One owner for episode transitions (both, especially web).** Providers can
   run their own up-next timers while OpenCloud has its five-second timer.
   Define ownership by capability to avoid duplicate prompts/transitions. Test
   slow initialization, autoplay rejection, final episodes, cancelled prompts
   and provider-native episode selectors. Clearly distinguish actual `ended`
   events from credits recognition. The resume fix accounts for CineSrc's
   internal episode identity; it does not implement a new credits detector or
   a universal browser autoplay controller.

## Improve access and operational confidence

7. **Player focus lifecycle (both).** The player has `role="dialog"` and
   `aria-modal`, but opening/closing does not establish and restore a complete
   focus lifecycle. Make background controls inert, place focus deliberately,
   restore the launch control and test keyboard/remote paths at iframe
   boundaries. Cross-origin key events do not automatically reach the parent.
8. **Website session regression coverage (web).** Test persisted Supabase
   sessions through site sleep/redeploy, browser reopening, refresh expiry and
   revocation. Revisit the one-time `oc_session_restored` logic in `js/main.js`,
   which removes Supabase storage keys when its marker is absent. Preserve
   account-access/revocation checks; don't introduce an unrestricted offline
   playback shortcut. No authentication behavior changes are part of this fix.
9. **Public catalog proxy protection (web).** `web/server.mjs` has fixed
   upstreams, bounded caching, timeouts and a concurrency cap, but not a full
   request-rate/user quota system. Add appropriate edge/API rate limits,
   observability and budget alerts before a larger public launch. A paid Render
   tier can remove idle cold starts, not provider/CDN buffering.

## Suggested order

Plan the backed-up progress-identity migration first. Then add trustworthy sync
feedback, movie Continue Watching and targeted runtime tests. Follow with focus
handling and diagnostics. Keep other feature additions optional and avoid
changing existing collections, provider choices or desktop updater behavior.
