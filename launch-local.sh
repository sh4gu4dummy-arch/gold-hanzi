#!/usr/bin/env bash
# Offline local launcher for gold-hanzi.
# Port 8045 — do not use 8080 (another game already uses that).
# Usage: ./launch-local.sh   →  http://127.0.0.1:8045/
set -euo pipefail
cd "$(dirname "$0")"
exec python3 ./launch-local.py
