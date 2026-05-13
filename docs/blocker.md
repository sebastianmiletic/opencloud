# Ad/Popup Blocker

A web-compatible port of Chrome extension popup-blocking logic, running entirely inside the app.

## Why Built-In?

Cross-origin iframes (video embeds) cannot be controlled by external extensions for popup blocking. The app runs its own blocker to intercept popup attempts from within the page.

## How It Works

### 1. Window.Open Override
Replaces `window.open` with a guarded version that checks rules before allowing the popup.

### 2. Link Click Interceptor
Captures clicks on links with `target="_blank"` or `target="_new"` and applies blocking rules.

### 3. JavaScript Link Blocking
Blocks `javascript:` scheme links when blocker is enabled.

### 4. BeforeUnload Trap Prevention
Prevents sites from showing "Are you sure you want to leave?" dialogs when aggressive blocking is on.

### 5. Iframe Injection
Uses `MutationObserver` to inject popup blocking into same-origin iframes as they are added to the DOM.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Enabled | true | Master switch |
| Block all new tabs | false | Blocks all `target="_blank"` links |
| Block all new windows | false | Blocks `window.open` calls |
| Allow same-site tabs | true | Allows popups to same domain |
| Allow extension pages | true | Allows chrome-extension URLs |

## Counter & Logs

- **Counter**: Total number of blocked popups (persisted)
- **Logs**: Last 500 blocked events with timestamp, URL, source, and reason
- Both are stored in `openccloud_blocker_settings`

## Limitations

- Cannot block cross-origin iframe popups (browser security restriction)
- Some sites may use unconventional popup methods not covered
- For comprehensive blocking, use a browser extension alongside this

## UI

Full Blocker tab in Settings with:
- Master toggle switch
- Individual rule toggles
- Live counter display
- Block log viewer with Clear button
- Reset counter button
