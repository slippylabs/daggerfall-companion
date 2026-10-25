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
node tools/build-dungeons.mjs
node tools/build-walk.mjs
node tools/build-names.mjs
node tools/build-ui.mjs
node tools/verify.mjs
node tools/test-recognise.mjs
node tools/test-route.mjs
node tools/test-save.mjs
node tools/test-now.mjs
node tools/test-walk.mjs
find site/data -type f \( -name '*.json' -o -name '*.bin' \) -exec gzip -9 -kf {} \;
