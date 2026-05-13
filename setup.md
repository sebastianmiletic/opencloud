# Setup & Deployment

## Prerequisites

- Python 3 (or Node.js as fallback)
- Modern browser (Chrome, Firefox, Safari, Edge)
- Free TMDB and OMDB API accounts

## 1. Get API Keys

### TMDB Bearer Token
1. Go to https://www.themoviedb.org/settings/api
2. Create an API key
3. Copy the **API Read Access Token** (Bearer token)

### OMDB API Key
1. Go to https://www.omdbapi.com/apikey.aspx
2. Request a free API key
3. Copy the key

## 2. Configure Environment

```bash
cd "Free Cloud"
cp .env.example .env
```

Edit `.env` and paste your keys:

```env
TMDB_BEARER_TOKEN=your_tmdb_bearer_token_here
OMDB_API_KEY=your_omdb_api_key_here
```

The `.env` file is `.gitignore`'d and will never be committed.

## 3. Start the App

```bash
./start.sh
```

This will:
1. Start a Python HTTP server on port 8080
2. Open your default browser at `http://localhost:8080`

**Or manually:**

```bash
python3 server.py
# Then open http://localhost:8080 in your browser
```

## 4. GitHub Setup

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/open-cloud.git
git push -u origin main
```

The `.gitignore` file ensures:
- `.env` (your API keys) is **NOT** committed
- `.env.example` (template without real keys) **IS** committed
- Others can copy `.env.example` to `.env` and add their own keys

## Important Notes

- **Never commit `.env`** — it contains your private API keys
- **Always use `http://localhost:8080`** — opening `index.html` directly via `file://` will not work because browsers block ES6 modules on local files
- The app includes an auto-redirect: if you accidentally open via `file://`, it will try to redirect to `localhost:8080`

## Stopping the Server

```bash
# Find and kill the process on port 8080
lsof -ti :8080 | xargs kill -9
```

Or press `Ctrl+C` if running in foreground.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Cannot load app from file://" | Use `http://localhost:8080`, not the file directly |
| "App failed to load" | Check browser console for JS errors; hard-refresh with `Cmd+Shift+R` |
| Server won't start (port in use) | Kill old process: `lsof -ti :8080 \| xargs kill -9` |
| No movies loading | Check `.env` has valid API keys; check browser console for fetch errors |
| Collection button not working | Hard-refresh the page to clear cached JS |
