# Open Cloud

A black-and-white themed streaming tracker web app with TMDB/OMDB integration, inline video player, Supabase authentication, Netflix-style animations, and a built-in ad/popup blocker.

---

## How to Download & Install

### Mac / Linux

1. **Install Python 3** (if you don't have it)
   ```bash
   python3 --version
   # If not installed: brew install python
   ```

2. **Clone the repository**
   ```bash
   git clone https://github.com/sebastianmiletic/opencloud.git
   cd opencloud
   ```

3. **Configure API keys**
   ```bash
   cp .env.example .env
   # Edit .env and add your TMDB Bearer Token, OMDB API Key, and Supabase credentials
   ```

4. **Start the app**
   ```bash
   ./start.sh
   # Or: python3 server.py
   ```

5. **Open** `http://localhost:8080` in your browser

### Windows

1. **Install Python 3** from [https://www.python.org/downloads/](https://www.python.org/downloads/) — check "Add Python to PATH"
2. **Clone** the repo or [download the ZIP](https://github.com/sebastianmiletic/opencloud/archive/refs/heads/main.zip) and extract it
3. **Open Command Prompt** or PowerShell in the extracted folder
4. **Copy** `.env.example` to `.env` and fill in your API keys
5. **Run** `python server.py`
6. **Open** `http://localhost:8080` in your browser

---

## How to Use the App

### Getting Started

1. **Open** `http://localhost:8080`
2. You will see a **Sign In** modal (mandatory — no close button). You must sign in or create an account to use the app
3. Enter your **email** and **password** to sign in, or switch to the **Create Account** tab to sign up
4. **Account creation** requires: a username, an email, and a password (6+ characters)
5. **Email confirmation is OFF** — accounts work immediately

### Home Page
- **Hero carousel** — Featured movies/shows at the top with auto-sliding slides
- **Categories** — "Popular Now", "Recently Released", "Star Wars Saga", and recommendation rows
- **Continue Watching** — Resume TV shows from where you left off
- **Search** — Type in the top-center search bar to find movies and TV shows
- **Item Modal** — Click any poster to see details, ratings, synopsis, and options to Watch Now or Add to Collection

### Navigating the App
- **Home** tab — Browse trending content
- **Collection** tab — Your saved movies/shows with folder support
- **History** tab — Shows and movies you've watched (auto-tracked)

### Player
- Click **Watch Now** on any item to open the inline player
- The current video source is shown in the top left of the player
- **Next Episode** button — Automatically skips to the next TV episode
- **Episodes** button — Opens a popover to choose any season/episode
- TV episodes auto-resume from where you left off

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
├── beta.css            # Experimental UI styles (deprecated)
├── server.py           # Python HTTP server + env injection
├── .env                # API keys (gitignored — never commit this)
├── .env.example        # Template for .env keys
├── version.json        # App version metadata
├── js/
│   ├── app.js          # Entry point, auth, update checker, app init
│   ├── auth.js         # Supabase authentication (sign in / up / out / password)
│   ├── api.js          # TMDB + OMDB fetch helpers
│   ├── ui.js           # Home, search, item modals, collection, history
│   ├── player.js       # Inline iframe player, episode picker, progress
│   ├── config.js       # API keys, providers, settings sync
│   ├── settings.js     # Settings modal logic (general / sources / blocker / stats / account / admin)
│   ├── storage.js      # Supabase-backed storage with in-memory caching
│   ├── sync.js         # Supabase database CRUD (collections, history, progress, admin)
│   ├── state.js        # Central reactive state module
│   ├── hero.js         # Hero carousel auto-slide + click handling
│   ├── blocker.js      # Ad/popup blocker with config and logs
│   ├── utils.js        # Toast, scroll lock, confirm dialog
│   └── supabase.js     # Watch sessions and stats aggregation
├── docs/
│   ├── supabase_schema.sql   # SQL for creating Supabase tables
│   └── architecture.md       # Architecture notes
└── README.md           # This file
```

---

## Features

### Core Streaming
- **Search** — Movies and TV shows via TMDB API
- **Inline Player** — Watch content with 7 different providers
- **Netflix UI** — Splash screen, hero carousel, smooth animations
- **Ad Blocker** — Built-in popup blocker with block logs
- **Continue Watching** — Auto-saves TV progress by season/episode
- **History** — Movies add after 5 minutes, TV adds after 1 second
- **Collections** — Save items and organize with folders

### Authentication
- **Supabase Auth** — Email/password with session persistence
- **One Account Per Email** — Strictly enforced
- **Usernames** — Choose a display name during signup
- **Account Actions** — Change password, change email, delete account
- **Admin Dashboard** — Full user management panel for `sebastian.miletic043@gmail.com`
  - See all users, last seen time, status
  - Kick users
  - Ban/unban users with reason
  - Wipe all user data
  - View per-user stats (collection, history, progress counts)
- **Ban System** — Banned users are prevented from signing in with a suspension message

### Settings Tabs
- **General** — Device layout (laptop / TV / phone), auto-play toggle
- **Video Sources** — Pick from 7 providers with quality and subtitle info
- **Blocker** — Toggle protection, configure rules, view block logs
- **Stats** — Watch heatmap, hours watched, movies/episodes count, current streak
- **Account** — Avatar upload, color presets, display name, email, password, account deletion
- **Admin** *(admin only)* — User management panel

### Updates
- **Smart Update Check** — Checks GitHub on every app load for code changes
- **Update Modal** — Opens a modal showing the commit message, author, date, and changed files. Has "Install Update Now" button
- **Ignores noise** — Won't notify for README, docs, images, or non-code changes
- **No more "Install Latest Update"** button in the old dropdown — it's all in the update modal now
- **After updating**, the badge disappears and the app is up to date

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

## Supabase Setup

1. Create a free project at [supabase.com](https://supabase.com)
2. Go to **Authentication > Providers > Email** and enable it
3. Turn **Confirm email** OFF
4. Run the SQL from `docs/supabase_schema.sql` in the SQL Editor
5. Copy your project URL and anon key into `.env`

**Admin auto-assignment**: `sebastian.miletic043@gmail.com` automatically gets `is_admin = true` on signup via the `createProfile` function.

---

## License

Private project.