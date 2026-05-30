#!/bin/bash
set -e

cd "$(dirname "$0")"

# ── Ensure the Python server port is clear ──
if command -v lsof &> /dev/null; then
    PID_ON_PORT=$(lsof -t -i :8765 2>/dev/null || true)
    if [ -n "$PID_ON_PORT" ]; then
        kill -9 $PID_ON_PORT 2>/dev/null || true
        sleep 0.5
    fi
fi

# ── Check Node / npm ──
if ! command -v node &> /dev/null || ! command -v npm &> /dev/null; then
    echo "❌ Node.js and npm are required."
    echo "   Install from https://nodejs.org and try again."
    exit 1
fi

# ── Install Electron (bundled, no internet needed once cached) ──
if [ ! -d "node_modules/electron" ]; then
    echo "📦 Installing Electron for the first time (~80 MB)..."
    npm install
fi

echo "🚀 Launching Open Cloud..."

# ── Start the Electron app ──
# Electron's main.js will spin up server.py internally
npx electron . > app.log 2>&1 &

sleep 2

# If the app didn't start, show log
echo "✅ Open Cloud started"
echo "   Logs: $(pwd)/app.log"
