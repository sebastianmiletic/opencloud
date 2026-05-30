#!/bin/bash
# Start Open Cloud local server and open browser

cd "$(dirname "$0")"

# Kill any stale server.py process
STALE_PIDS=$(pgrep -f "python.*/server\.py" 2>/dev/null)
if [ -n "$STALE_PIDS" ]; then
    echo "Killing stale server processes..."
    kill -9 $STALE_PIDS 2>/dev/null
    sleep 2
fi

# Start the server
if command -v python3 &> /dev/null; then
    echo "Starting Open Cloud server with Python on port 8080..."
    nohup python3 server.py > server.log 2>&1 &
elif command -v python &> /dev/null; then
    echo "Starting Open Cloud server with Python on port 8080..."
    nohup python server.py > server.log 2>&1 &
else
    echo "ERROR: Python 3 is required to run the local server."
    echo "Install from https://python.org and try again."
    exit 1
fi

SERVER_PID=$!

# Wait for server to write port
PORT=""
for i in $(seq 1 40); do
    if [ -f server_port.txt ]; then
        PORT=$(cat server_port.txt)
        break
    fi
    if ! kill -0 $SERVER_PID 2>/dev/null; then
        echo "ERROR: Server process exited unexpectedly"
        tail -n 20 server.log
        exit 1
    fi
    sleep 0.25
done

if [ -z "$PORT" ]; then
    echo "ERROR: Server did not start write port file in time"
    tail -n 20 server.log
    exit 1
fi

# Wait for HTTP response
READY=0
for i in $(seq 1 40); do
    if curl -s -o /dev/null --max-time 1 "http://localhost:$PORT/"; then
        READY=1
        break
    fi
    sleep 0.25
done

if [ "$READY" -ne 1 ]; then
    echo "ERROR: Server did not respond on port $PORT"
    tail -n 20 server.log
    exit 1
fi

URL="http://localhost:$PORT"
echo "Open Cloud is ready: $URL"

# Open browser
if command -v open &> /dev/null; then
    open "$URL"
elif command -v xdg-open &> /dev/null; then
    xdg-open "$URL"
else
    echo "Open your browser and go to: $URL"
fi
