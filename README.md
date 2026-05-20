# Open Cloud

A black-and-white themed streaming tracker web app with TMDB/OMDB integration, inline video player, multi-account system, Netflix-style animations, and built-in ad/popup blocker.

## Installation & Setup

### Mac

1. **Install Python 3** (if you don't have it)
   ```bash
   # Check if Python 3 is installed
   python3 --version

   # If not installed, download from https://www.python.org/downloads/
   # Or install via Homebrew:
   brew install python
   ```

2. **Clone the repo**
   ```bash
   git clone https://github.com/sebastianmiletic/opencloud.git
   cd opencloud
   ```

3. **Get your free API keys**
   - **TMDB Bearer Token**: Go to https://www.themoviedb.org/settings/api and copy your "API Read Access Token"
   - **OMDB API Key**: Go to https://www.omdbapi.com/apikey.aspx and get a free key

4. **Set up your .env file**
   ```bash
   cp .env.example .env
   ```
   Open `.env` in any text editor and paste your keys:
   ```
   TMDB_BEARER_TOKEN=your_tmdb_token_here
   OMDB_API_KEY=your_omdb_key_here
   ```

5. **Start the app**
   ```bash
   ./start.sh
   ```
   Or manually:
   ```bash
   python3 server.py
   ```

6. **Open your browser** and go to `http://localhost:8080`

---

### Windows

1. **Install Python 3** (if you don't have it)
   - Download from https://www.python.org/downloads/
   - Run the installer and **check "Add Python to PATH"**
   - Open Command Prompt or PowerShell and verify:
     ```cmd
     python --version
     ```

2. **Clone the repo**
   ```cmd
   git clone https://github.com/sebastianmiletic/opencloud.git
   cd opencloud
   ```
   *(If you don't have Git, download the ZIP from GitHub and extract it)*

3. **Get your free API keys**
   - **TMDB Bearer Token**: Go to https://www.themoviedb.org/settings/api and copy your "API Read Access Token"
   - **OMDB API Key**: Go to https://www.omdbapi.com/apikey.aspx and get a free key

4. **Set up your .env file**
   ```cmd
   copy .env.example .env
   ```
   Open `.env` in Notepad or any text editor and paste your keys:
   ```
   TMDB_BEARER_TOKEN=your_tmdb_token_here
   OMDB_API_KEY=your_omdb_key_here
   ```

5. **Start the app**
   ```cmd
   python server.py
   ```

6. **Open your browser** and go to `http://localhost:8080`

---

## Features

- **Streaming Tracker**: Search and browse movies/TV shows via TMDB API
- **Inline Video Player**: Watch content directly in the app with 7 provider sources
- **Multi-Account System**: Fully isolated Collection per user profile
- **Netflix-Style UI**: Splash intro, hero carousel, smooth animations
- **Ad/Popup Blocker**: Built-in blocker with configurable settings and logs
- **Per-Account Data**: Collection data fully isolated per profile
- **Continue Watching**: Auto-saves your episode/season progress and resumes where you left off
- **Collection Folders**: Create folders and organize your collection

## Tech Stack

- Vanilla JavaScript (ES6 modules)
- TMDB API + OMDB API
- Python 3 HTTP server (local development)
- CSS3 with CSS variables
- Font Awesome icons
- LocalStorage for persistence

## API Keys

You need two free API keys:

1. **TMDB Bearer Token**: Get at https://www.themoviedb.org/settings/api
2. **OMDB API Key**: Get at https://www.omdbapi.com/apikey.aspx

Add them to your `.env` file (which is `.gitignore`'d and never committed).

## Project Structure

```
Free Cloud/
├── index.html          # Main app shell
├── styles.css          # All styles (black/white theme)
├── start.sh            # Launcher script
├── server.py           # Python HTTP server
├── .env                # API keys (gitignored)
├── .env.example        # Template for API keys
├── .gitignore          # Git ignore rules
├── js/                 # JavaScript modules
│   ├── app.js          # Entry point
│   ├── config.js       # API keys, providers, settings
│   ├── state.js        # Shared mutable state
│   ├── storage.js      # localStorage wrappers
│   ├── utils.js        # Toast, scroll lock, confirm modal
│   ├── api.js          # TMDB/OMDB fetch functions
│   ├── ui.js           # Search, categories, modals, grids
│   ├── hero.js         # Hero carousel
│   ├── player.js       # Inline player & episode picker
│   ├── accounts.js     # Multi-account system
│   ├── settings.js     # Settings modal
│   └── blocker.js      # In-app ad/popup blocker
└── docs/               # Documentation
```

## Video Providers

Seven sources with custom single-word names:

| Name | Source | Quality | Subtitles |
|------|--------|---------|-----------|
| Nova | vidsrc.cc | 1080p | Yes |
| Phantom | vidsrc.to | 1080p | No |
| Dossier | moviesapi.club | 720p | No |
| Pulse | vidsrc.me | 1080p | Yes |
| Helix | player.videasy.net | 4K | Yes |
| Zenith | vidsrc.su | 1080p | No |
| Vertex | vidlink.pro | 4K | Yes |

## License

Private project.
