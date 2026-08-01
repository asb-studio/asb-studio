#!/usr/bin/env python3
"""
Local development server for Asb Studio.

ES modules cannot be loaded from a file:// URL - the browser blocks them.
So the studio is always served over http, even when it is only ever used on
one laptop. Run this from the asb-studio folder:

    python serve.py

    http://localhost:8765/                  the studio

Caching is disabled on purpose: during development an edited .js file must
take effect on a plain refresh, with no hard-reload dance.
"""

import http.server
import socketserver
import webbrowser
from pathlib import Path

PORT = 8765
ROOT = Path(__file__).parent.resolve()


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def log_message(self, fmt, *args):
        # Keep the console readable; only surface real problems.
        if args and str(args[1]).startswith(("4", "5")):
            super().log_message(fmt, *args)


Handler.extensions_map.update({
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
})


def main():
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
        url = f"http://localhost:{PORT}/"
        print(f"Asb Studio:  {url}")
        print("Ctrl+C to stop.")
        try:
            webbrowser.open(url)
        except Exception:
            pass
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()
