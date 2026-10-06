# OpenCloud on Render

This is a separate HTTPS website, not a desktop installer. It does not change
Tauri, Electron, release tags, or the desktop updater. The same source builds
into `web-dist`; a dedicated Node server publishes only that directory.

## Deploy

1. Push `render.yaml`, `web/server.mjs` and the accompanying frontend changes to
   your GitHub repository (or a dedicated web branch).
2. In Render, choose **New → Blueprint**, connect the repository and select that
   branch. Render reads `render.yaml` and creates `opencloud-web`.
3. Enter the four configuration values requested by Render:
   - `TMDB_BEARER_TOKEN`: TMDB API read-access token.
   - `OMDB_API_KEY`: OMDb API key.
   - `SUPABASE_URL`: Supabase project URL.
   - `SUPABASE_ANON_KEY`: public anon/publishable key. Never use a service-role key.
4. Deploy. Use the HTTPS `onrender.com` URL Render assigns, not an assumed URL.
5. Add that exact URL to Supabase Authentication's allowed redirect URLs.
   Configure the Site URL for this site if using a separate Supabase project.
   If sharing the desktop project's backend, preserve existing URLs and settings.
6. Test sign-up, sign-in, password/email flows, collections, search and playback
   in a normal browser before announcing public availability.

### Updating the existing site

`opencloud-web.onrender.com` currently follows the **`render-web`** branch.
Pushing `main` or publishing a GitHub desktop release alone does not deploy it.
After checks pass, verify there are no web-only commits, then fast-forward:

```bash
git fetch origin main render-web
git merge-base --is-ancestor origin/render-web main
git push origin main:render-web
```

Do not force-push over web-only work. Confirm Render's GitHub deployment status
is successful, check `/env.js` for the expected `APP_VERSION`, and verify the live
UI and `/api/sports` endpoint. A local build does not prove the site was deployed.

## Separation and data

- Use a separate Supabase project if the website must have entirely separate
  accounts/data. Apply `docs/supabase_schema.sql` and migrations in order.
- Using the existing project shares account-scoped cloud collections/history
  with the app intentionally. Browser local storage remains separate.
- RLS and database signup-abuse protections must be enabled before public use.
- No app data lives on Render's ephemeral filesystem. Do not clear the desktop
  app's data or migrate its WebView storage to launch the site.

## Security and operation

TMDB and OMDb credentials stay on the server. The browser receives only their
same-origin proxy paths and the public Supabase configuration. Catalog proxying
is read-only, limited to fixed destinations, has timeouts, a bounded one-minute
cache and a concurrency cap. It never proxies video streams or arbitrary URLs.
These controls are not a full per-user abuse/quota system: monitor API usage and
add edge rate limits before a large public launch. Only distribute content you
have permission to provide and comply with provider and API terms.

Render's free web service can sleep while idle. A paid instance avoids those
cold starts. Provider media streams go directly from the browser to the provider;
a faster Render plan will not fix a slow video CDN.

## Browser differences

Embedded sources can reject specific site origins or browser privacy policies.
The website cannot inject Tauri's script into cross-origin providers. Progress
uses the providers' own messaging APIs; popup interception is not equivalent to
the desktop app. Browser-native popup blocking applies. Verify each source on
the deployed HTTPS domain; a successful local build does not guarantee provider
playback. Desktop installation/downgrade actions are not available on the web.

### Saving and resuming playback

| Source | Playback messages | Saved-position input |
| --- | --- | --- |
| Plasma | Relayed VidAPI `PLAYER_EVENT` (`player_progress` / `player_duration`) | `startAt` |
| Platinum | CineSrc `cinesrc:*` events/getter responses | `t` and `continueprompt=false` |
| Ultra | `PLAYER_EVENT` | `startAt` |
| Illumini | `PLAYER_EVENT` | `startAt` |
| Helix (`player.videasy.net`) | `PLAYER_EVENT` | `progress` |

Messages must match the active iframe and a verified provider origin. Providers
with content identifiers must match the title, type and TV episode. Short
advertisement samples and malformed messages are rejected. Movies and each
individual TV episode use the existing account-scoped progress store, shared
with the app through Supabase. Collections/history are not cleared or migrated.

The latest received position is cached in memory; localStorage checkpoints run
at most every ten seconds during ordinary playback. Pause/seek events, closing
the player, hiding the page and `pagehide` flush the latest observed position.
Cloud synchronization is periodic and best effort on exit. On reopening,
`initStorage()` reconciles local and cloud progress, including locally saved
checkpoints whose cloud request did not finish. An abrupt browser/OS crash can
lose updates since the most recent durable checkpoint, and events cannot report
time more precisely than the provider emits it.

Reopening a supported source supplies the saved position automatically, without
an OpenCloud confirmation prompt. CineSrc also supports getter requests for a
fresh checkpoint and internal episode-change events to keep progress assigned
to the correct episode. Native Tauri playback continues to use its existing
all-frame bridge, not a second browser listener.

Other visible sources currently have no verified web progress integration and
are marked **No web progress API** in the player source menu. Do not substitute
elapsed wall-clock time or attempt to read their cross-origin video DOM.
Illumini documents that its own existing browser progress may override
`startAt`; OpenCloud cannot clear another origin's storage. Blocking provider
messages, changed provider protocols, or unsupported redirects can also prevent
saving/restoring. Browser autoplay policies still apply: automatically restoring
a position is not a guarantee of automatic audible playback.

Plasma's events are relayed by `vsembed.ru` from its nested CloudOrchestra
player. The browser integration accepts only the current outer iframe's source
and exact `https://vsembed.ru` origin, validates `player_info.tmdb`, media type and
TV coordinates, and maps `playing`, `paused`, `seeked` and `completed` statuses.
The `startAt` parameter is preserved through both wrapper layers into the media
player's configuration. See [Plasma verification](plasma-web-resume.md) for
actual movie/episode resume results and remaining browser limitations.

References checked for this change: [VidAPI](https://vidapi.ru/api), Plasma's
public wrapper/player scripts, [CineSrc](https://cinesrc.st/docs),
[VidPhantom](https://vidphantom.com), [VidLink](https://vidlink.pro), and Helix's
public embed scripts (which read the `progress` query and emit `PLAYER_EVENT`).
A live Chromium CineSrc movie-550 probe, with muted autoplay, observed a requested
321.4-second start followed by time advancing from 321.400995 to 325.06627.
This validates that probe, not every source/title or the user's browser.
The full player also passed mocked cross-origin browser tests for movie close,
real page navigation/reload and per-episode TV resume. Unit tests exercise the
actual storage/persistence functions with network/UI dependencies stubbed.

## Local production smoke test

```
npm ci
npm run build:web
# Export the four variables above in your shell, then:
npm run start:render
```

Visit `http://localhost:10000`; `/healthz` should return `{"ok":true}`.
Environment values are read at server startup, not baked into frontend bundles.
