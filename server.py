#!/usr/bin/env python3
"""Simple HTTP server for Open Cloud with proper MIME types and env injection."""
import http.server
import socketserver
import os

PORT = 8080

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
        super().end_headers()

    def do_GET(self):
        # Serve env.js endpoint
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
socketserver.TCPServer.allow_reuse_address = True

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"\n🚀 Open Cloud running at http://localhost:{PORT}/")
    print("Press Ctrl+C to stop\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n👋 Server stopped.")
