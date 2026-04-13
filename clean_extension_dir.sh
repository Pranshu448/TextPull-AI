#!/bin/zsh
set -euo pipefail

cd /Users/pranshu/Documents/textpull-ai
rm -rf __pycache__ _metadata
find . -name '*.pyc' -delete
echo "Extension folder cleaned."
