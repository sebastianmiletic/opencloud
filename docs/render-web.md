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
The website cannot inject Tauri's script into cross-origin providers, so exact
video progress/resume and popup interception are not equivalent to the desktop
app. Browser-native popup blocking applies. Verify each source on the deployed
HTTPS domain; a successful local build does not guarantee provider playback.
Desktop installation/downgrade actions are not available on the web.

## Local production smoke test

```
npm ci
npm run build:web
# Export the four variables above in your shell, then:
npm run start:render
```

Visit `http://localhost:10000`; `/healthz` should return `{"ok":true}`.
Environment values are read at server startup, not baked into frontend bundles.
