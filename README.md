# Open Cloud

A black-and-white themed streaming tracker web app with TMDB/OMDB integration, inline video player, Supabase authentication, Netflix-style animations, and built-in ad/popup blocker.

## Installation & Setup

### Mac

1. **Install Python 3** (if you don't have it)
   ```bash
   python3 --version
   # If not installed: brew install python
   ```

2. **Clone the repo**
   ```bash
   git clone https://github.com/sebastianmiletic/opencloud.git
   cd opencloud
   ```

3. **Configure API keys**
   ```bash
   cp .env.example .env
   # Edit .env and add your TMDB, OMDB, and Supabase keys
   ```

4. **Start the app**
   ```bash
   ./start.sh
   # Or: python3 server.py
   ```

5. **Open** `http://localhost:8080`

### Windows

1. **Install Python 3** from https://www.python.org/downloads/ (check "Add Python to PATH")
2. **Clone** or download ZIP from GitHub
3. **Copy** `.env.example` to `.env` and fill in your API keys
4. **Run** `python server.py`
5. **Open** `http://localhost:8080`

---

## Features

### Core
- **Streaming Tracker** — Search and browse movies/TV shows via TMDB API
- **Inline Video Player** — Watch content directly with 7 provider sources
- **Netflix-Style UI** — Splash intro, hero carousel, smooth animations
- **Ad/Popup Blocker** — Built-in blocker with configurable settings and logs
- **Continue Watching** — Auto-saves episode/season progress
- **Collection Folders** — Create folders and organize your collection

### Authentication & Accounts
- **Supabase Auth** — Email/password authentication with session persistence
- **One Account Per Email** — Enforced by Supabase auth
- **Username** — Choose a unique username during signup
- **Account Management** — Change password, change email, delete account
- **Admin Dashboard** — Admin-only panel for viewing all users (sebastian.miletic043@gmail.com only)

### Data & Sync
- **Cloud Sync** — Collections, watch history, progress, and settings sync to Supabase
- **Cross-Device** — Sign in anywhere and your data follows you
- **Auto History** — Movies added after 5 min watch time, TV after 1 second

### Settings
- **Device Layout** — Laptop, TV, or Phone optimized interface
- **Video Source** — 7 providers with quality/subtitle info
- **BETA UI** — Toggle experimental redesigned interface
- **Auto-Play** — Optional autoplay when opening player

### Updates
- **GitHub Version Check** — Automatically checks for new versions from the repo
- **One-Click Update** — Clear cache and reload to latest version
- **Stays Signed In** — Update preserves your session and all data

## Tech Stack

- Vanilla JavaScript (ES6 modules)
- TMDB API + OMDB API
- Supabase (Auth + PostgreSQL)
- Python 3 HTTP server
- CSS3 with CSS variables
- Font Awesome icons

## Project Structure

```
Open Cloud/
├── index.html          # Main app shell
├── styles.css          # Standard UI styles
├── beta.css            # Experimental BETA UI styles
├── server.py           # Python HTTP server + env injection
├── start.sh            # Launcher script
├── .env                # API keys (gitignored)
├── .env.example        # API keys template
├── version.json        # App version for update checking
├── js/
│   ├── app.js          # Entry point
│   ├── auth.js         # Supabase authentication
│   ├── sync.js         # Database sync (collections, history, settings)
│   ├── config.js       # API keys, providers, settings
│   ├── settings.js     # Settings modal
│   ├── ui.js           # Search, categories, modals, grids
│   ├── player.js       # Inline player & episode picker
│   ├── api.js          # TMDB/OMDB fetch functions
│   └── ...
└── docs/               # Documentation & Supabase schema
```

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

## Supabase Setup

1. Create a free project at [supabase.com](https://supabase.com)
2. Go to **Authentication > Providers > Email** and enable it
3. Turn **Confirm email** OFF
4. Run the SQL from `docs/supabase_schema.sql` in the SQL Editor
5. Copy your project URL and anon key into `.env`

## License

Private project.
