#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf dist/
hatch build -t wheel
mkdir -p web/public/wheels
cp dist/mango_explorer-*.whl web/public/wheels/
