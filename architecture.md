# Architecture

Open Cloud is built as a modular vanilla JavaScript app using ES6 modules. All modules live under `js/` and are imported via `<script type="module">`.

## Module Overview

### Entry Point
- **`app.js`** — Initializes all modules, wires up global event listeners, handles splash screen, and bootstraps the app.

### State Management
- **`state.js`** — Central mutable state with setter functions. All modules import state from here to read, and call setters to write. This avoids circular dependencies.

### Configuration
- **`config.js`** — API keys (read from `.env` via `/env.js`), provider definitions, device layouts, settings helpers. All sensitive data is externalized to `.env`.

### Storage
- **`storage.js`** — localStorage wrappers for accounts, collections, and OMDB cache. Keys are prefixed per user (`openccloud_user_{name}_*`).

### UI
- **`ui.js`** — The largest module. Handles search, category rows, item modals, collection grid, and user interactions.

### Hero
- **`hero.js`** — Netflix-style hero carousel with clone-based seamless infinite loop, synchronized progress bar timer, and pause-on-hover.

### Player
- **`player.js`** — Inline video player overlay with episode/season picker for TV shows.

### Accounts
- **`accounts.js`** — Multi-account system: switch, add, remove accounts. Per-account data isolation.

### Settings
- **`settings.js`** — Tabbed settings modal with General, Video Sources, and Blocker tabs.

### Blocker
- **`blocker.js`** — In-app ad/popup blocker ported from Chrome extension logic. Intercepts `window.open`, link clicks, and iframe popups.

### Utilities
- **`utils.js`** — Toast notifications, in-app confirm modal, scroll lock/unlock, HTML escaping.

### API
- **`api.js`** — Fetch wrappers for TMDB and OMDB with caching.

## Data Flow

```
User Action → ui.js/hero.js/player.js → state.js → storage.js → localStorage
                    ↓
              api.js (TMDB/OMDB)
```

## Event Bus

Some modules communicate via `CustomEvent` on `window` to break circular dependencies:

- `heroOpenModal` — hero slide clicked → open item modal
- `heroAddToCollection` — hero add button → add to collection

## Per-Account Isolation

Every account has its own localStorage keys:
- `openccloud_user_{name}_usercollection` — Collection

## Security

- API keys are stored in `.env` (`.gitignore`'d)
- Server reads `.env` and serves it as `/env.js`
- `config.js` reads from `window.ENV` with empty fallbacks
- No sensitive data is hardcoded in committed files
