# Open Cloud

A black-and-white themed streaming tracker web app with TMDB/OMDB integration, inline video player, multi-account system, Netflix-style animations, and built-in ad/popup blocker.

## Features

- **Streaming Tracker**: Search and browse movies/TV shows via TMDB API
- **Inline Video Player**: Watch content directly in the app with 7 provider sources
- **Multi-Account System**: Fully isolated Collection per user profile
- **Netflix-Style UI**: Splash intro, hero carousel, smooth animations
- **Ad/Popup Blocker**: Built-in blocker with configurable settings and logs
- **Per-Account Data**: Collection data fully isolated per profile

## Tech Stack

- Vanilla JavaScript (ES6 modules)
- TMDB API + OMDB API
- Python 3 HTTP server (local development)
- CSS3 with CSS variables
- Font Awesome icons
- LocalStorage for persistence

## Quick Start

```bash
# Copy the example env file and add your API keys
cp .env.example .env

# Start the server and open browser
./start.sh
```

The app runs at `http://localhost:8765`.

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
