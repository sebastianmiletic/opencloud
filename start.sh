#!/bin/bash
# Start Open Cloud local server and open browser

cd "$(dirname "$0")"

# Kill any stale process on port 8080
STALE_PID=$(lsof -ti :8080 2>/dev/null)
if [ -n "$STALE_PID" ]; then
    echo "Killing stale server on port 8080 (PID: $STALE_PID)..."
    kill -9 "$STALE_PID" 2>/dev/null
    sleep 0.5
fi

# Start the server
if command -v python3 &> /dev/null; then
    echo "Starting Open Cloud server with Python..."
    nohup python3 server.py > /dev/null 2>&1 &
elif command -v python &> /dev/null; then
    echo "Starting Open Cloud server with Python..."
    nohup python server.py > /dev/null 2>&1 &
elif command -v node &> /dev/null; then
    echo "Starting Open Cloud server with Node..."
    nohup npx -y serve -l 8080 > /dev/null 2>&1 &
else
    echo "ERROR: Need Python 3 or Node.js to run the local server."
    echo "Install one of them, or run manually:"
    echo "  python3 -m http.server 8080"
    exit 1
fi

# Wait for server to be ready
echo -n "Waiting for server"
for i in {1..30}; do
    if curl -s -o /dev/null --max-time 1 http://localhost:8080/; then
        echo ""
        break
    fi
    echo -n "."
    sleep 0.3
done

# Open browser
if command -v open &> /dev/null; then
    open "http://localhost:8080"
elif command -v xdg-open &> /dev/null; then
    xdg-open "http://localhost:8080"
else
    echo ""
    echo "Server is running. Open your browser and go to:"
    echo "  http://localhost:8080"
fi
