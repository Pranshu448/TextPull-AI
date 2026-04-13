#!/bin/zsh
set -euo pipefail

cd /Users/pranshu/Documents/textpull-ai
rm -rf __pycache__ _metadata
export PYTHONDONTWRITEBYTECODE=1
python3 server.py
