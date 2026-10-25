#!/usr/bin/env bash
# Rebuild every data file from ARENA2 + the DFO Online source, then verify.
#   DFO_REPO=~/projects/dfo ARENA2=~/projects/daggerfall-data/ARENA2 ./build.sh
set -euo pipefail
cd "$(dirname "$0")"
node tools/build-data.mjs
node tools/build-images.mjs
node tools/build-towns.mjs
node tools/build-quests.mjs
node tools/build-roads.mjs
node tools/build-ui.mjs
node tools/verify.mjs
node tools/test-recognise.mjs
node tools/test-route.mjs
find site/data -type f \( -name '*.json' -o -name '*.bin' \) -exec gzip -9 -kf {} \;
