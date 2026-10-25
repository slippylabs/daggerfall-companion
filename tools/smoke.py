"""Browser smoke test for the guide: drives every tab with Playwright and checks the results.

usage: python smoke.py [BASE_URL] [SHOT_DIR]
Defaults to serving ../site on a local port. Exit code 1 on any failure.
"""
import functools
import http.server
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

SITE = Path(__file__).resolve().parent.parent / 'site'
SHOTS = Path(sys.argv[2] if len(sys.argv) > 2 else '/tmp/dg-shots')
SHOTS.mkdir(parents=True, exist_ok=True)

JOURNAL = ("The Fighters Guild of Daggerfall has hired me to kill a troublesome werewolf, wereboar, or whatever, "
           "in its lair, Ruins of Wickston Manor. The beast needs to be dead in 5 days time for me to collect my payment. "
           "Gondywyr Hearthhouse of Daggerfall has charged me with delivering a package to Bedoryan Kingwing at "
           "The Wickford Residence. I should also visit The Convocation of Elona.")

DELIVERY = ("Morndas, 4th of Morning Star, 3E 405: Gondywyr Hearthhouse of Daggerfall has charged me with the task of "
            "delivering a package to Bedoryan Kingwing, also of Daggerfall. I have to have it there by this time tomorrow.")

results = []


def check(ok, what):
    results.append(ok)
    print(('PASS ' if ok else 'FAIL ') + what)


def serve():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(SITE))
    handler.log_message = lambda *a: None
    httpd = socketserver.TCPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return f'http://127.0.0.1:{httpd.server_address[1]}/'


def run(base, width, height, mobile):
    tag = f'{width}'
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={'width': width, 'height': height}, is_mobile=mobile, has_touch=mobile,
                                  ignore_https_errors=True)
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'whoami' not in m.text and 'net::ERR_FAILED' not in m.text and 'cloudflareinsights' not in m.text else None)
        page.goto(base + '#journal')
        page.wait_for_function('document.querySelector("#here-input") && !document.querySelector("#tab-journal").hidden')

        # Where I am: Daggerfall
        page.fill('#here-input', 'Daggerfall')
        page.wait_for_selector('#here-list li')
        page.click('#here-list li >> nth=0')
        check(page.input_value('#here-input') == 'Daggerfall', f'[{tag}] "I am in" set to Daggerfall')

        # Journal
        page.fill('#journal-input', JOURNAL)
        page.click('#journal-find')
        page.wait_for_selector('#journal-out .dg-card')
        names = page.eval_on_selector_all('#journal-out .dg-card-name', 'els => els.map(e => e.textContent)')
        print(f'  journal found: {names}')
        for want in ['Ruins of Wickston Manor', 'The Fighters Guild', 'The Convocation of Elona', 'The Wickford Residence']:
            check(want in names, f'[{tag}] journal finds "{want}"')
        trip = page.inner_text('#journal-out')
        check('day' in trip and 'km' in trip, f'[{tag}] journal cards show travel time and distance from Daggerfall')
        # The quest is recognised from its journal wording, with the blanks read back
        panel = page.inner_text('#journal-out .dg-quest-match')
        check('Hunt for a Lycanthrope' in panel, f'[{tag}] journal entry recognised as Hunt for a Lycanthrope')
        check('5 days' in panel and 'On foot' in panel and 'On horseback' in panel, f'[{tag}] deadline check: 5 days vs the trip on foot and by horse')
        page.screenshot(path=str(SHOTS / f'journal_{tag}.png'), full_page=True)

        page.click('#journal-out .dg-quest-match .dg-save')
        page.fill('#journal-input', DELIVERY)
        page.click('#journal-find')
        page.wait_for_selector('#journal-out .dg-quest-match')
        panel = page.inner_text('#journal-out .dg-quest-match')
        check('The Delivery Boy' in panel, f'[{tag}] delivery entry recognised as The Delivery Boy')
        check('Bedoryan Kingwing in Daggerfall' in panel and 'Not the person who gave you the quest' in panel,
              f'[{tag}] claim reward from Bedoryan Kingwing (the recipient), by name')
        check('Gondywyr Hearthhouse' in panel and 'pays your reward' in panel, f"[{tag}] who's who lists both people and marks the payer")
        page.click('#journal-out .dg-quest-match .dg-save')
        page.click('#journal-out .dg-quest-match >> text=Full walkthrough')
        page.wait_for_function('!document.querySelector("#tab-quests").hidden && document.querySelector("#quest-detail .dg-chip-filled")')
        check('Bring' in page.inner_text('#quest-detail .dg-steps') and 'Bedoryan Kingwing' in page.inner_text('#quest-detail .dg-steps'),
              f'[{tag}] walkthrough steps use the real names')
        page.screenshot(path=str(SHOTS / f'walkthrough_{tag}.png'), full_page=True)
        page.click('.hud-tab[data-tab="journal"]')
        page.fill('#journal-input', JOURNAL)
        page.click('#journal-find')
        page.wait_for_selector('#journal-out .dg-card')

        # Show on map from the journal
        page.click('#journal-out .dg-card:has-text("Ruins of Wickston Manor") >> text=Show on map')
        page.wait_for_function('!document.querySelector("#tab-map").hidden')
        page.wait_for_timeout(800)
        check('Ruins of Wickston Manor' in page.inner_text('#map-detail'), f'[{tag}] "Show on map" selects the dungeon')
        check(page.inner_text('#map-title') == 'Daggerfall', f'[{tag}] map opens the Daggerfall region page')
        page.screenshot(path=str(SHOTS / f'map_{tag}.png'), full_page=True)

        # Map search
        page.fill('#map-search', 'Wayrest')
        page.wait_for_selector('#map-suggest li')
        page.click('#map-suggest li >> nth=0')
        page.wait_for_timeout(500)
        detail = page.inner_text('#map-detail')
        check('Wayrest' in detail and 'day' in detail, f'[{tag}] map search finds Wayrest with a trip from Daggerfall')

        # World view and region click
        page.click('#map-world')
        page.wait_for_timeout(300)
        check('tap a region' in page.inner_text('#map-title'), f'[{tag}] world view shows')

        # Quests
        page.click('.hud-tab[data-tab="quests"]')
        page.wait_for_selector('#quest-list li')
        page.fill('#quest-search', 'Delivery Boy')
        page.wait_for_selector('#quest-detail .dg-reward')
        reward = page.inner_text('#quest-detail .dg-reward')
        check(('townsperson' in reward or 'Bedoryan Kingwing' in reward) and 'Not the person who gave you the quest' in reward,
              f'[{tag}] The Delivery Boy: claim reward from the recipient')
        page.fill('#quest-search', 'Hunt for a Lycanthrope')
        page.wait_for_function('document.querySelector("#quest-detail h2")?.textContent === "Hunt for a Lycanthrope"')
        check('quest giver' in page.inner_text('#quest-detail .dg-reward'), f'[{tag}] Hunt for a Lycanthrope: reward from the quest giver')
        page.screenshot(path=str(SHOTS / f'quests_{tag}.png'), full_page=True)

        # Towns
        page.click('.hud-tab[data-tab="towns"]')
        page.wait_for_selector('#town-buildings .dg-bgroup')
        towns = page.inner_text('#town-buildings')
        check('The Fighters Guild' in towns and 'The Mages Guild' in towns, f'[{tag}] Daggerfall town lists the guild halls')
        page.fill('#building-search', 'Mages')
        page.wait_for_timeout(300)
        check('The Mages Guild' in page.inner_text('#town-buildings'), f'[{tag}] building search finds The Mages Guild')
        page.screenshot(path=str(SHOTS / f'towns_{tag}.png'), full_page=True)

        # My quests: both saved quests, with who pays and the trips
        page.click('.hud-tab[data-tab="mine"]')
        page.wait_for_selector('#mine-list .dg-mine')
        mine = page.inner_text('#mine-list')
        check(page.locator('#mine-list .dg-mine').count() == 2, f'[{tag}] My quests holds the two saved quests')
        check('Bedoryan Kingwing in Daggerfall' in mine, f'[{tag}] My quests: claim reward from Bedoryan Kingwing in Daggerfall')
        check('Ruins of Wickston Manor' in mine and 'longer than the time left' in mine,
              f'[{tag}] My quests: the Lycanthrope trip is flagged as longer than the 5 days left')
        check('my quests (2)' in page.inner_text('.hud-tab[data-tab="mine"]').lower(), f'[{tag}] tab shows the count')
        page.screenshot(path=str(SHOTS / f'mine_{tag}.png'), full_page=True)
        page.click('#mine-list .dg-mine >> nth=0 >> text=Done — remove')
        page.wait_for_timeout(300)
        check(page.locator('#mine-list .dg-mine').count() == 1, f'[{tag}] Done removes a quest')

        # Layout: no sideways scroll, and at phone width every control is thumb-sized
        overflow = page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
        check(overflow <= 0, f'[{tag}] no horizontal overflow ({overflow}px)')
        if mobile:
            small = []
            for t in ['journal', 'map', 'quests', 'towns', 'mine']:
                page.click(f'.hud-tab[data-tab="{t}"]')
                page.wait_for_timeout(300)
                small += page.evaluate('''() => [...document.querySelectorAll('button, select, input, a, summary')]
                  .filter(e => e.offsetParent && !e.closest('.sl-legal'))
                  .filter(e => !(e.type === 'checkbox' && e.closest('label') && e.closest('label').getBoundingClientRect().height >= 40))
                  .filter(e => !(e.tagName === 'A' && e.closest('p')))
                  .map(e => [e.id || e.className || e.tagName, e.textContent.trim().slice(0, 24), Math.round(e.getBoundingClientRect().height), Math.round(e.getBoundingClientRect().width)])
                  .filter(([, , h, w]) => h < 40 || w < 40)''')
            seen = set()
            small = [s for s in small if not (tuple(s) in seen or seen.add(tuple(s)))]
            for s in small[:12]:
                print('  small target:', s)
            check(not small, f'[{tag}] all touch targets at least 40px ({len(small)} small)')
        check(not errors, f'[{tag}] no console errors {errors[:3]}')
        browser.close()


base = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1].startswith('http') else serve()
run(base, 1280, 900, False)
run(base, 390, 844, True)
print(f'\n{sum(results)} passed, {len(results) - sum(results)} failed')
sys.exit(0 if all(results) else 1)
