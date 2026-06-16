# Open Cloud

A black-and-white themed streaming tracker desktop app with TMDB/OMDB integration, inline video player, Supabase authentication, Netflix-style animations, and a built-in ad/popup blocker via Electron. Track what you watch, save your favorites, and resume where you left off.

---

## How to Download & Install

### macOS (Recommended — DMG Installer)

1. **Download the DMG**
   - Go to the [**Releases**](https://github.com/sebastianmiletic/opencloud/releases/latest) page
   - Download **`OpenCloud.dmg`**

2. **Install**
   - Open the downloaded `.dmg` file
   - In the window that appears, **drag** the `OpenCloud.app` icon onto the **Applications** folder shortcut
   - Eject the mounted disk

3. **Launch**
   - Open **Finder > Applications** and double-click `OpenCloud`
   - **First launch only:** because the app is unsigned, macOS will show a security warning.   
     Right-click `OpenCloud.app` → **Open** → click **Open** in the dialog.   
     After this one-time step, you can open it normally from Spotlight or the Dock.

> **Note:** Spotlight may take a few seconds to index the app after first launch.

### Windows (Recommended — EXE Installer)

1. **Download the EXE**
   - Go to the [**Releases**](https://github.com/sebastianmiletic/opencloud/releases/latest) page
   - Download **`OpenCloud.exe`**

2. **Install**
   - Run the downloaded `.exe` and follow the setup wizard
   - A desktop shortcut will be created automatically

### Build from Source (Mac / Linux / Windows)

If you prefer to run the app from code or want to develop:

1. **Download the ZIP**
   - Go to [github.com/sebastianmiletic/opencloud](https://github.com/sebastianmiletic/opencloud)
   - Click the green **<> Code** button → **Download ZIP**

2. **Unzip / extract** the file and open the extracted folder

3. **Install dependencies and start**
   - **Mac / Linux:**
     ```bash
     ./start.sh
     ```
   - **Windows:**
     ```cmd
     npm install && npx electron .
     ```

> **Note:** API keys are bundled with the ZIP — no configuration needed.
> **Note:** Electron must be installed once via `npm install`. After that the app launches instantly.

---

## How to Use the App

### Getting Started

1. **Open** the app — it launches in its own desktop window (no browser required)
2. You will see a **Sign In** modal (mandatory — no close button). You must create an account or sign in to use the app
3. **Account creation** requires: a username, an email, and a password (6+ characters)
4. **Email confirmation is OFF** — accounts work immediately

### Home Page
- **Hero carousel** — Featured movies/shows at the top with auto-sliding slides
- **Categories** — "Popular Now", "Recently Released", "Star Wars Saga", and recommendation rows
- **Continue Watching** — Resume TV shows from where you left off
- **Search** — Type in the top-center search bar to find movies and TV shows
- **Item Modal** — Click any poster to see details, ratings, synopsis, and options to Watch Now or Add to Collection

### Navigating the App
- **Home** tab — Browse trending content
- **Collection** tab — Your saved movies/shows with folder support
- **History** tab — Movies and shows you've watched, with posters, ratings, and watch dates

### Player
- Click **Watch Now** on any item to open the inline player
- The current video source is shown in the top left of the player
- **Next Episode** button — Automatically skips to the next TV episode
- **Episodes** button — Opens a popover to choose any season/episode
- TV episodes auto-resume from where you left off
- **Watch History** — Items are automatically added to your History when you open the player

### Account Dropdown (top-right avatar)
- **Settings** — Opens the settings modal
- **Check for Updates** — Opens an update modal showing if there's a new version and what changed
- **Sign Out** — Log out and return to the sign-in screen

---

## Project Structure

```
Open Cloud/
├── index.html          # Main app shell with all modals
├── styles.css          # Main black-and-white theme styles
├── server.py           # Python HTTP server + env injection + port fallback
├── start.sh            # Bash launcher (kills stale servers, launches Electron)
├── .env                # API keys (bundled in ZIP — no manual config needed)
├── .env.example        # Template for custom .env keys
├── version.json        # App version metadata
├── icon.png            # App icon (cloud, transparent background)
├── icon.icns           # macOS app icon
├── icon.ico            # Windows app icon
├── js/
│   ├── main.js         # App entry point, auth, init
│   ├── auth.js         # Supabase authentication (sign in / up / out / password)
│   ├── api.js          # TMDB + OMDB fetch helpers
│   ├── ui.js           # Home, search, item modals, collection, history
│   ├── player.js       # Inline iframe player, episode picker, progress, history tracking
│   ├── config.js       # API keys, providers, settings sync
│   ├── settings.js     # Settings modal logic (general / sources / blocker / stats / account / admin)
│   ├── storage.js      # Supabase-backed storage with in-memory caching
│   ├── sync.js         # Supabase database CRUD (collections, history, progress, admin)
│   ├── state.js        # Central reactive state module
│   ├── hero.js         # Hero carousel auto-slide + click handling
│   ├── blocker.js      # Built-in ad/popup blocker with block logs
│   ├── utils.js        # Toast, scroll lock, confirm dialog
│   ├── accounts.js     # User avatar/name initializer
│   └── supabase.js     # Watch sessions and stats aggregation
├── electron/           # Electron desktop wrapper
│   ├── main.js         # Electron main process: server launcher + popup blocker
│   └── preload.js      # Preload script (currently empty)
├── docs/
│   ├── supabase_schema.sql   # SQL for creating Supabase tables
│   ├── SUPABASE_SETUP.md     # Step-by-step Supabase setup guide
│   └── MIGRATION.md          # Migration notes for existing installations
└── README.md           # This file
```

---

## Features

### Core Streaming
- **Search** — Movies and TV shows via TMDB API
- **Inline Player** — Watch content with 7 different providers
- **Netflix UI** — Splash screen, hero carousel, smooth animations
- **Ad/Popup Blocker** — Electron-level protection that blocks popups, iframe redirects, and beforeunload traps
- **Continue Watching** — Auto-saves TV progress by season/episode
- **History** — Auto-tracks every movie and show you open in the player, with poster, rating, and year
- **Collections** — Save items and organize with folders

### Authentication
- **Supabase Auth** — Email/password with session persistence
- **One Account Per Email** — Strictly enforced
- **Usernames** — Choose a display name during signup
- **Account Actions** — Change password, change email, delete account
- **Admin Dashboard** — Full user management panel for admin accounts
  - See all users, last seen time, status
  - Kick users
  - Ban/unban users with reason
  - Wipe all user data
  - View per-user stats (collection, history, progress counts)
- **Admin Activation** — Users can activate admin access via an activation key in Settings > General
- **Ban System** — Banned users are prevented from signing in with a suspension message

### Settings Tabs
- **General** — Device layout (laptop / TV / phone), auto-play toggle, activation key input
- **Video Sources** — Pick from 7 providers with quality and subtitle info
- **Blocker** — Toggle protection, configure rules, view block logs
- **Stats** — Watch heatmap, hours watched, movies/episodes count, current streak
- **Account** — Avatar upload, color presets, display name, email, password, account deletion
- **Admin** *(admin only)* — User management panel (activated via activation key)

### Updates
- **Manual Update Check** — Click "Check for Updates" in the account dropdown
- **Update Modal** — Shows commit message, author, date, and changed files. Has "Install Update Now" button
- **Ignores noise** — Won't notify for README, docs, images, or non-code changes
- **After installing**, caches are cleared and the page reloads

---

## Video Providers

| Name | Source | Quality | Subtitles |
|------|--------|---------|-----------|
| Nova | vidsrc.cc | 1080p | Yes |
| Helix | player.videasy.net | 4K | Yes |
| Pulse | vidsrc.me | 1080p | Yes |
| Phantom | vidsrc.to | 1080p | No |
| Dossier | moviesapi.club | 720p | No |
| Zenith | vidsrc.su | 1080p | No |
| Vertex | vidlink.pro | 4K | Yes |

---

## Supabase Setup (for custom hosting)

If you want to use your own Supabase project instead of the bundled one:

1. Create a free project at [supabase.com](https://supabase.com)
2. Go to **Authentication > Providers > Email** and enable it
3. Turn **Confirm email** OFF
4. Run the SQL from `docs/supabase_schema.sql` in the SQL Editor
5. Copy your project URL and anon key into `.env`
6. Restart the app

**Admin access** can be activated by any user who enters the correct activation key in **Settings > General**.

---

## License

Private project.
