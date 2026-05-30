#!/usr/bin/env python3
"""Simple HTTP server for Open Cloud with proper MIME types and env injection."""
import http.server
import os
import socket
import socketserver
import time

PORT        = 8080

# Load environment variables from .env file
def load_env():
    env = {}
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
    if os.path.exists(env_path):
        with open(env_path, 'r') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                if '=' in line:
                    key, value = line.split('=', 1)
                    env[key.strip()] = value.strip()
    return env

ENV = load_env()

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()

    def do_GET(self):
        if self.path.startswith('/env.js'):
            self.send_response(200)
            self.send_header('Content-Type', 'application/javascript')
            self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
            self.end_headers()
            js = f"""window.ENV = {{
  TMDB_BEARER_TOKEN: '{ENV.get('TMDB_BEARER_TOKEN', '')}',
  OMDB_API_KEY: '{ENV.get('OMDB_API_KEY', '')}',
  SUPABASE_URL: '{ENV.get('SUPABASE_URL', '')}',
  SUPABASE_ANON_KEY: '{ENV.get('SUPABASE_ANON_KEY', '')}'
}};"""
            self.wfile.write(js.encode('utf-8'))
            return
        return super().do_GET()

os.chdir(os.path.dirname(os.path.abspath(__file__)))

# Allow port reuse to prevent "Address already in use" after restart
class ReuseServer(socketserver.TCPServer):
    def server_bind(self):
        self.socket = socket.socket(self.address_family, self.socket_type)
        self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.socket.bind(self.server_address)
        self.server_address = self.socket.getsockname()
        self.socket.listen(self.request_queue_size)

# Pin to port 8080 for stable localStorage. Retry a few times in case of stale bind.
# If still busy, fall back to a free port so the app always starts.
httpd = None
chosen_port = None
max_retries = 5
for attempt in range(max_retries):
    try:
        httpd = ReuseServer(("", PORT), Handler)
        chosen_port = PORT
        break
    except OSError as e:
        if attempt < max_retries - 1:
            print(f"  Port {PORT} busy, retrying in 1s... (attempt {attempt + 1}/{max_retries})")
            time.sleep(1)
        else:
            # Fallback: find any free port
            try:
                s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                s.bind(("", 0))
                chosen_port = s.getsockname()[1]
                s.close()
                httpd = ReuseServer(("", chosen_port), Handler)
                print(f"  ⚠️  Port {PORT} unavailable. Falling back to port {chosen_port}.")
            except Exception:
                print(f"\nERROR: Could not bind to any port.")
                exit(1)

print(f"\n🚀 Open Cloud running at http://localhost:{chosen_port}/")
print("Press Ctrl+C to stop\n")

# Write chosen port to file so start.sh can read it
with open('server_port.txt', 'w') as f:
    f.write(str(chosen_port))

try:
    httpd.serve_forever()
except KeyboardInterrupt:
    print("\n👋 Server stopped.")
