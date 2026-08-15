# Electron to Tauri migration

The tracked Open Cloud application now supports Electron and Tauri side by side.
Electron remains the rollback build until the parity checklist below passes on
macOS and Windows.

## Local development

```bash
npm install
npm run electron:dev
npm run tauri:dev
```

Run all static checks and both frontend/Rust builds with:

```bash
npm run check
```

## Local-data handoff

The Electron preload exports supported localStorage values to
`tauri-migration-v1.json` in Electron's user-data directory. The Tauri bootstrap
imports missing keys once and writes a `.imported` marker only after the browser
storage transaction succeeds.

Supabase session tokens are deliberately not imported from Electron. Users may
need to sign in again. Dev access is always revalidated from Supabase and has no
client-side activation flag.

## Blocker architecture

- Rust owns the durable blocker policy, counter, and last 500 events.
- `on_new_window` denies native popup requests.
- `on_navigation` applies the provider/app host allowlist, including iframe
  navigation on WKWebView.
- An initialization script runs before provider scripts in every frame and
  intercepts `window.open`, popup links/forms, programmatic clicks, JavaScript
  URLs, and child-frame unload traps.
- Blocked child-frame events are relayed to the existing Settings > Blocker UI.

The blocker has been smoke-tested against the Helix provider and stopped a real
advertising popup while playback remained embedded.

## Release signing

The updater public key is committed in `src-tauri/tauri.conf.json`. The matching
private key is intentionally ignored at `src-tauri/.keys/opencloud.key` and must
be backed up securely, then stored in GitHub as `TAURI_SIGNING_PRIVATE_KEY`.
Losing it prevents future installed versions from accepting updates.

The release workflow also accepts the standard Apple signing/notarization
secrets. Windows code signing can be added to the workflow when a certificate is
available.

The macOS job deliberately builds both `app` and `dmg`: the DMG is the manual
installer, while the signed `.app.tar.gz` is the payload used by Tauri's updater.

## Parity checklist

Test on macOS Apple Silicon, a universal/Intel build, Windows 10, and Windows 11.

- [ ] Fresh install, Electron migration, sign-in, sign-up, sign-out
- [ ] Home rows, hero, recommendations, search, filters, and item modal
- [ ] Collection add/remove, folders, sorting, and Supabase synchronization
- [ ] History, continue watching, episode progress, and watch statistics
- [ ] Profile avatar/color/name, email/password changes, and account deletion
- [ ] Owner-only Dev list, presence, installation details, suspend/sign-out, restore, and audit history
- [ ] Non-owner direct Dev access is denied and profile emails cannot be enumerated
- [ ] Offline launch shows the connection-required authorization gate
- [ ] All seven providers: movie, TV, next episode, episode picker, subtitles,
      autoplay, fullscreen, and close/reopen
- [ ] Blocker enabled/disabled and each rule combination
- [ ] No unauthorized new window, top-level navigation, or iframe redirect
- [ ] Counter/log/reset/clear behavior survives restart
- [ ] Update check, signed download, install, and restart
- [ ] DMG drag-install and NSIS current-user install/uninstall/shortcuts
- [ ] Visual comparison at 1480x920 and 1024x640 in laptop/TV/phone layouts
