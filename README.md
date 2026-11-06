# Daggerfall Quest Guide

> **ARCHIVED 2026-11-06.** No longer in use. daggerfall.slippylabs.com now 301-redirects to
> https://projects.slippylabs.com/. The last served docroot is in `~/archive/daggerfall-docroot-2026-11-06.tar.gz`
> and its vhost in `~/archive/daggerfall.slippylabs.conf.served-2026-11-06`.

https://daggerfall.slippylabs.com/

A companion site for DFO Online (https://daggerfalljs.dev/) and Daggerfall. The game keeps your
save inside its own site, so the guide works from what you paste in:

- **Journal:** paste a quest entry. It finds the towns, dungeons and buildings the entry names,
  with direction, distance and the game's own fast-travel time from where you are.
- **Map & search:** the game's travel-map art for every region, with every location dot placed by
  the game's own rules. Search any place and see the route.
- **Quests:** all 265 quest scripts as walkthroughs, with the steps, the time limit and who to see
  to claim the reward. That person is read from the script; 75 quests pay out from someone other
  than the quest giver.
- **Towns:** every named building in every town, on a north-up sketch.

## Build

    DFO_REPO=~/projects/dfo ARENA2=~/projects/daggerfall-data/ARENA2 ./build.sh

The build imports DFO Online's own file readers (MIT) and needs Daggerfall's ARENA2 data, which
is freeware. Only derived data is committed under `site/`. `tools/verify.mjs` checks the data
against DFO's modules: the travel times match exactly on 32,000 trips, and building names and
quest reward-givers match what we saw in the real game. `tools/smoke.py` drives every tab in a
headless browser.

## Deploy

    sudo cp -r site/. /var/www/daggerfall.slippylabs.com/ && sudo chown -R root:root /var/www/daggerfall.slippylabs.com

See NOTICE.md for credits.
