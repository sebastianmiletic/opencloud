#!/bin/bash
# Start Open Cloud local server and open browser

cd "$(dirname "$0")"

# ── Free port 8765 aggressively ──
echo "Preparing Open Cloud..."

# 1. Try to kill any python process that looks like our server
STALE_PIDS=$(pgrep -f "python.*server\.py" 2>/dev/null)
if [ -n "$STALE_PIDS" ]; then
    kill -9 $STALE_PIDS 2>/dev/null
    sleep 1
fi

# 2. Use lsof to kill whatever is sitting on port 8765 (even root-owned)
if command -v lsof &> /dev/null; then
    PID_ON_PORT=$(lsof -t -i :8765 2>/dev/null)
    if [ -n "$PID_ON_PORT" ]; then
        kill -9 $PID_ON_PORT 2>/dev/null
        sleep 1
        # If still there, try sudo (may prompt once)
        PID_ON_PORT=$(lsof -t -i :8765 2>/dev/null)
        if [ -n "$PID_ON_PORT" ]; then
            sudo kill -9 $PID_ON_PORT 2>/dev/null
            sleep 1
        fi
    fi
fi

# 3. Final wait for OS to release the port
sleep 1

# ── Start the server ──
if command -v python3 &> /dev/null; then
    nohup python3 server.py > server.log 2>&1 &
elif command -v python &> /dev/null; then
    nohup python server.py > server.log 2>&1 &
else
    echo "ERROR: Python 3 is required to run the local server."
    echo "Install from https://python.org and try again."
    exit 1
fi

SERVER_PID=$!

# Wait for server to write port file
PORT=""
for i in $(seq 1 60); do
    if [ -f server_port.txt ]; then
        PORT=$(cat server_port.txt)
        break
    fi
    if ! kill -0 $SERVER_PID 2>/dev/null; then
        echo "ERROR: Server process exited unexpectedly"
        tail -n 30 server.log
        exit 1
    fi
    sleep 0.25
done

if [ -z "$PORT" ]; then
    echo "ERROR: Server did not write port file in time"
    tail -n 30 server.log
    exit 1
fi

# Wait for HTTP response
READY=0
for i in $(seq 1 60); do
    if curl -s -o /dev/null --max-time 1 "http://localhost:$PORT/"; then
        READY=1
        break
    fi
    if ! kill -0 $SERVER_PID 2>/dev/null; then
        echo "ERROR: Server process died while starting"
        tail -n 30 server.log
        exit 1
    fi
    sleep 0.25
done

if [ "$READY" -ne 1 ]; then
    echo "ERROR: Server did not respond on port $PORT"
    tail -n 30 server.log
    exit 1
fi

URL="http://localhost:$PORT"
if [ "$PORT" != "8765" ]; then
    echo "⚠️  Port 8765 was busy. Using fallback port $PORT."
    echo "   Your data is still safe, but bookmarks should point to $URL"
fi
echo "✅ Open Cloud is ready: $URL"

# Open browser
if command -v open &> /dev/null; then
    open "$URL"
elif command -v xdg-open &> /dev/null; then
    xdg-open "$URL"
else
    echo "Open your browser and go to: $URL"
fi
