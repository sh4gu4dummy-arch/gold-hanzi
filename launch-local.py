#!/usr/bin/env python3
"""Offline static server for dist/. Port 8045 (not 8080 — another game uses that)."""
from __future__ import annotations

import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# Port 8045 — unique for gold-hanzi; do not use 8080.
HOST = "127.0.0.1"
PORT = 8045


class SpaHandler(SimpleHTTPRequestHandler):
    """Serve files from cwd; unknown paths → index.html (BrowserRouter SPA)."""

    def do_GET(self) -> None:  # noqa: N802
        raw = self.path.split("?", 1)[0].split("#", 1)[0]
        if not os.path.isfile(self.translate_path(raw)):
            self.path = "/index.html"
        return SimpleHTTPRequestHandler.do_GET(self)


def main() -> int:
    root = Path(__file__).resolve().parent
    dist = root / "dist"
    if not (dist / "index.html").is_file():
        print("dist/ missing. Run: npm run build", file=sys.stderr)
        print("Then re-run the launcher.", file=sys.stderr)
        return 1

    os.chdir(dist)
    url = f"http://{HOST}:{PORT}/"
    print(f"Serving dist/ at {url}")
    print("Ctrl+C to stop.\n")
    httpd = ThreadingHTTPServer((HOST, PORT), SpaHandler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
