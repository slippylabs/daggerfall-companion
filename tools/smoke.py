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
        road_px = '''() => { const c = document.querySelector('#map-canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] === 60 && d[i + 1] === 60 && d[i + 2] === 60) n++; return n; }'''
        page.wait_for_function(f'({road_px})() > 500')
        roads_on = page.evaluate(road_px)
        page.click('label:has(#map-roads)')
        page.wait_for_timeout(200)
        roads_off = page.evaluate(road_px)
        check(roads_on > 500 and roads_off < roads_on / 10, f'[{tag}] roads drawn on the region map, and the toggle hides them ({roads_on} -> {roads_off} px)')
        page.click('label:has(#map-roads)')
        g = page.evaluate('''() => { const c = document.querySelector('#map-canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] === 242 && d[i + 1] === 205 && d[i + 2] === 82) n++; return n; }''')
        check(g > (100 if mobile else 200), f'[{tag}] region map: cities are gold diamonds ({g} px)')
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
        gold = '''() => { const c = document.querySelector('#map-canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] === 242 && d[i + 1] === 205 && d[i + 2] === 82) n++; return n; }'''
        page.wait_for_timeout(300)
        g = page.evaluate(gold)
        check(g > (500 if mobile else 1500), f'[{tag}] world view: the cities are gold diamonds ({g} px)')
        page.screenshot(path=str(SHOTS / f'world_{tag}.png'), full_page=True)

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
        # a Beautiful Villages town: the layout DFO Online shows, not classic Daggerfall's
        page.fill('#town-input', 'Cromcart')
        page.wait_for_selector('#town-suggest li')
        page.click('#town-suggest li >> nth=0')
        page.wait_for_function('document.querySelector("#town-buildings")?.innerText.includes("Rusty Badger")')
        check('5 named buildings and 23 houses' in page.inner_text('#town-buildings'), f'[{tag}] Cromcart has DFO Online\'s layout (5 named, 23 houses)')
        page.fill('#town-input', 'Ruins of Wickston Manor')
        page.wait_for_selector('#town-suggest li')
        page.click('#town-suggest li >> nth=0')
        page.wait_for_selector('#dungeon-view canvas')
        check(not page.is_hidden('#dungeon-view') and 'top to bottom' in page.inner_text('#dungeon-view'), f'[{tag}] any dungeon opens as a map in Towns & dungeons')
        page.fill('#town-input', 'Daggerfall')
        page.wait_for_selector('#town-suggest li')
        page.click('#town-suggest li >> nth=0')
        page.wait_for_function('!document.querySelector("#town-cols").hidden')

        # My quests: both saved quests, with who pays and the trips
        page.click('.hud-tab[data-tab="mine"]')
        page.wait_for_selector('#mine-list .dg-mine')
        mine = page.inner_text('#mine-list')
        check(page.locator('#mine-list .dg-mine').count() == 2, f'[{tag}] My quests holds the two saved quests')
        check('Bedoryan Kingwing in Daggerfall' in mine, f'[{tag}] My quests: claim reward from Bedoryan Kingwing in Daggerfall')
        check('Ruins of Wickston Manor' in mine and 'longer than the time left' in mine,
              f'[{tag}] My quests: the Lycanthrope trip is flagged as longer than the 5 days left')
        check('my quests (2)' in page.inner_text('.hud-tab[data-tab="mine"]').lower(), f'[{tag}] tab shows the count')
        page.click('#mine-list .dg-planner > summary')
        plan = page.inner_text('#mine-list .dg-planner')
        check('Ruins of Wickston Manor' in plan and 'after its days run out' in plan and 'Total:' in plan,
              f'[{tag}] route planner orders the stops and flags the late dungeon')
        page.screenshot(path=str(SHOTS / f'mine_{tag}.png'), full_page=True)
        page.click('#mine-list .dg-planner >> text=Show route on map')
        page.wait_for_function('!document.querySelector("#tab-map").hidden')
        page.wait_for_timeout(600)
        check(page.inner_text('#map-title') == 'Daggerfall', f'[{tag}] planned route opens on the map')
        page.screenshot(path=str(SHOTS / f'route_{tag}.png'), full_page=True)
        page.click('.hud-tab[data-tab="mine"]')
        page.wait_for_selector('#mine-list .dg-mine')
        # Progress: the next step is spelled out; "Job done" drops the dungeon from the route
        lyc = page.locator('#mine-list .dg-mine:has-text("Hunt for a Lycanthrope")')
        check('Next:' in lyc.inner_text() and 'Steps (0/' in lyc.inner_text(), f'[{tag}] My quests shows the next step and a step count')
        lyc.locator('label:has-text("Job done")').click()
        page.wait_for_timeout(300)
        lyc = page.locator('#mine-list .dg-mine:has-text("Hunt for a Lycanthrope")')
        check('claim your reward' in lyc.inner_text() and 'dg-mine-done' in lyc.get_attribute('class'), f'[{tag}] job done: next step is claiming the reward')
        page.click('#mine-list .dg-planner > summary')
        check('Ruins of Wickston Manor' not in page.inner_text('#mine-list .dg-planner'), f'[{tag}] job done: the dungeon leaves the route')
        page.reload()
        page.wait_for_selector('#mine-list .dg-mine')
        check(page.locator('#mine-list .dg-mine-done').count() == 1, f'[{tag}] progress is kept after a reload')
        # the journal entry of a quest already saved is not saved twice
        page.click('.hud-tab[data-tab="journal"]')
        page.fill('#journal-input', DELIVERY)
        page.click('#journal-find')
        page.wait_for_selector('#journal-out .dg-quest-match .dg-save')
        check(page.inner_text('#journal-out .dg-save').lower() == 'saved ✓', f'[{tag}] an entry already saved shows Saved')
        page.click('.hud-tab[data-tab="mine"]')
        page.wait_for_selector('#mine-list .dg-mine')
        page.click('#mine-list .dg-mine >> nth=0 >> text=Done — remove')
        page.wait_for_timeout(300)
        check(page.locator('#mine-list .dg-mine').count() == 1, f'[{tag}] Done removes a quest')

        # Load from the game: DFO Online's "Export all saves" zip with two saves; pick the newest
        zip_path = str(Path(__file__).resolve().parent / 'fixtures' / 'DFO-Online-Saves.zip')
        page.set_input_files('#save-file', zip_path)
        page.wait_for_selector('#mine-list .dg-save-pick')
        picks = page.locator('#mine-list .dg-save-pick')
        check(picks.count() == 2 and 'beast slain' in picks.nth(0).inner_text().lower(), f'[{tag}] save file: two saves offered, newest first')
        picks.nth(0).click()
        page.wait_for_selector('#mine-list .dg-import-msg b')
        msg = page.inner_text('#mine-list .dg-import-msg')
        check('Loaded 2 quests' in msg and 'Penbrugh' in msg, f'[{tag}] save loaded: 2 quests, "I am in" set from where the game was saved')
        check(page.input_value('#here-input') == 'Penbrugh', f'[{tag}] header now says I am in Penbrugh')
        # Do this now: one NOW per quest, exact place and action
        cards = page.locator('#mine-list .dg-mine-now')
        check(cards.count() == 2 and page.locator('#mine-list .dg-step-now').count() == 2, f'[{tag}] each quest card shows exactly one NOW')
        dv = page.locator('#mine-list .dg-mine-now:has-text("The Delivery Boy") .dg-step-now').inner_text()
        print('  delivery NOW:', dv.replace(chr(10), ' / ')[:200])
        check('Daggerfall' in dv and 'The Wickford Residence' in dv and 'part of town' in dv and 'Give the book' in dv
              and 'Bedoryan Kingwing' in dv and 'who pays your reward' in dv, f'[{tag}] Delivery Boy NOW: the exact house, the book and who pays')
        hn = page.locator('#mine-list .dg-mine-now:has-text("Hunt for a Lycanthrope") .dg-step-now').inner_text()
        check('Collect your reward from Lord Kain Mastercroft' in hn and 'The Fighters Guild' in hn, f'[{tag}] Hunt (beast slain) NOW: collect the reward at the Fighters Guild')
        check('away' in dv, f'[{tag}] NOW shows the trip from where you are')
        # the player's own journal, on the card: the game's words with the save's names
        jl = page.locator('#mine-list .dg-mine-now:has-text("The Delivery Boy") .dg-jline').inner_text()
        check('Journal:' in jl and 'Bedoryan Kingwing' in jl and 'Gondywyr Hearthhouse' in jl and '_' not in jl, f'[{tag}] the card shows the journal entry ({jl[:60]}…)')
        # the item the step needs, as the inventory shows it: name, page, where, the clicks
        inv = page.locator('#mine-list .dg-mine-now:has-text("The Delivery Boy") .dg-inv').inner_text()
        check('Book' in inv and 'In your pack' in inv and 'page' in inv, f'[{tag}] the card shows the book as the inventory has it ({inv.splitlines()[1][:60] if len(inv.splitlines()) > 1 else inv[:60]})')
        # Copy for help: the card and the quest's state as text
        page.evaluate("window.__copied = null; navigator.clipboard.writeText = t => { window.__copied = t; return Promise.resolve(); }")
        page.locator('#mine-list .dg-mine-now:has-text("The Delivery Boy") .dg-help').click()
        page.wait_for_function('window.__copied')
        copied = page.evaluate('window.__copied')
        check('Quest: The Delivery Boy (A0C00Y14)' in copied and 'NOW: Give the book' in copied and '"goal"' in copied and '_pickuplocal_ | Person | Bedoryan Kingwing' in copied and '_book_ | pack | Book' in copied,
              f'[{tag}] Copy for help copies the card and the quest state ({len(copied)} chars)')
        page.screenshot(path=str(SHOTS / f'save_{tag}.png'), full_page=True)
        # NOW's Town map: the recipient's house circled
        page.locator('#mine-list .dg-mine-now:has-text("The Delivery Boy") .dg-go-town').click()
        page.wait_for_selector('#town-head .dg-town-mark')
        where = page.inner_text('#town-head .dg-town-mark')
        check('The Wickford Residence' in where and 'part of town' in where, f'[{tag}] Town map: the quest house is marked in Daggerfall ({where.splitlines()[-1][:70]})')
        page.wait_for_timeout(500)
        colours = page.evaluate('''() => { const c = document.querySelector('#town-map canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          const n = {}; const key = (r, g, b) => ({ '24,85,190': 'shop', '195,125,69': 'temple', '48,117,85': 'tavern', '242,205,82': 'select', '207,176,122': 'street' })[[r, g, b].join()];
          for (let i = 0; i < d.length; i += 4) { const k = key(d[i], d[i + 1], d[i + 2]); if (k) n[k] = (n[k] || 0) + 1; } return n; }''')
        check(all(colours.get(k, 0) > 50 for k in ['shop', 'street', 'select']), f'[{tag}] town map: the game\'s own colours, the quest house lit up ({colours})')
        box = page.locator('#town-map canvas').bounding_box()
        page.mouse.move(box['x'] + 5, box['y'] + 5)
        page.screenshot(path=str(SHOTS / f'house_{tag}.png'), full_page=True)
        # the older save: the werewolf is alive, so NOW is the kill and THEN the reward
        page.click('.hud-tab[data-tab="mine"]')
        page.wait_for_selector('#mine-list .dg-import')
        page.set_input_files('#save-file', zip_path)
        page.wait_for_selector('#mine-list .dg-save-pick')
        page.locator('#mine-list .dg-save-pick').nth(1).click()
        page.wait_for_selector('#mine-list .dg-import-msg b')
        page.wait_for_timeout(300)
        hunt = page.locator('#mine-list .dg-mine-now:has-text("Hunt for a Lycanthrope")')
        hn, ht = hunt.locator('.dg-step-now').inner_text(), hunt.locator('.dg-then').inner_text()
        check('Kill the Werewolf' in hn and 'Ruins of Wickston Manor' in hn and 'then:' in ht.lower() and 'Collect your reward' in ht,
              f'[{tag}] Hunt (beast alive): NOW kill the Werewolf in Ruins of Wickston Manor, THEN the reward')
        check(page.locator('#mine-list .dg-mine-now').count() == 2, f'[{tag}] loading again refreshes, never doubles')
        # the walkthrough follows the game: the card says the step, the walkthrough marks it
        chip = hunt.locator('.dg-stepchip')
        check(chip.count() == 1 and 'step 1 of 2' in chip.inner_text().lower(), f'[{tag}] quest card shows the step it is on ({chip.inner_text() if chip.count() else "none"})')
        chip.click()
        page.wait_for_selector('#quest-detail .dg-st-now')
        now_step = page.inner_text('#quest-detail .dg-st-now')
        check('Kill' in now_step and 'step 1 of 2' in page.inner_text('#quest-detail .dg-walk-where'),
              f'[{tag}] walkthrough marks the step you are on ({now_step.splitlines()[0][:60]})')
        check(page.locator('#quest-detail .dg-st-next').count() >= 1, f'[{tag}] walkthrough marks the next step')
        page.screenshot(path=str(SHOTS / f'walkstep_{tag}.png'), full_page=True)
        page.click('.hud-tab[data-tab="mine"]')
        page.wait_for_selector('#mine-list .dg-mine-now')
        hunt = page.locator('#mine-list .dg-mine-now:has-text("Hunt for a Lycanthrope")')
        hunt.locator('.dg-go-dungeon').click()
        page.wait_for_selector('#dungeon-view .dg-town-mark')
        spot = page.inner_text('#dungeon-view .dg-town-mark')
        check('of the entrance' in spot and page.locator('#dungeon-view canvas').count() == 1 and page.is_hidden('#town-cols'),
              f'[{tag}] Dungeon map: the werewolf is pinned with directions ({spot.splitlines()[1][:80]})')
        check('quest target' in page.inner_text('#dungeon-view .dg-level'), f'[{tag}] dungeon map: the level picker opens on the target level')
        page.wait_for_function('document.querySelector("#dungeon-view .dg-route-line")?.innerText.includes("Route:")', timeout=20000)
        rl = page.inner_text('#dungeon-view .dg-route-line')
        gold = page.evaluate('''() => { const c = document.querySelector('#dungeon-view canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 225 && d[i + 1] > 180 && d[i + 1] < 220 && d[i + 2] < 120) n++; return n; }''')
        check('m of corridor' in rl and gold > 100, f'[{tag}] dungeon route drawn through the corridors ({rl[:90]}; {gold} px)')
        page.screenshot(path=str(SHOTS / f'dungeon_{tag}.png'), full_page=True)
        page.click('.hud-tab[data-tab="mine"]')
        page.wait_for_selector('#mine-list .dg-mine')
        check(page.locator('#mine-list .dg-bar').count() == 1, f'[{tag}] with quests, sync is a slim bar')
        n = page.locator('#mine-list .dg-mine-now').count()
        page.locator('#mine-list .dg-mine-now .dg-done').first.click()
        page.wait_for_timeout(300)
        check(page.locator('#mine-list .dg-mine-now').count() == n - 1, f'[{tag}] the header ✓ removes a finished quest')

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
                  .filter(e => !e.classList.contains('dg-file'))
                  .map(e => [e.id || e.className || e.tagName, e.textContent.trim().slice(0, 24), Math.round(e.getBoundingClientRect().height), Math.round(e.getBoundingClientRect().width)])
                  .filter(([, , h, w]) => h < 40 || w < 40)''')
            seen = set()
            small = [s for s in small if not (tuple(s) in seen or seen.add(tuple(s)))]
            for s in small[:12]:
                print('  small target:', s)
            check(not small, f'[{tag}] all touch targets at least 40px ({len(small)} small)')
        check(not errors, f'[{tag}] no console errors {errors[:3]}')
        browser.close()


REALM_ID = 'r' + '0123456789abcdef0123'
REALM_SAVE = (Path(__file__).resolve().parent / 'fixtures' / 'realm-save.json').read_bytes()
REALM_LATER = (Path(__file__).resolve().parent / 'fixtures' / 'realm-save-later.json').read_bytes()
REALM = {'seq': 1, 'body': REALM_SAVE, 'data_gets': 0}   # the fake account service's character, changed mid-test


def serve_fake_dfo():
    """A stand-in for daggerfalljs.dev plus DFO's account service on one local origin: a blank page, and
    GET /v1/realm and /v1/realm/<id>/data that answer only to the Bearer secret."""
    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            auth = self.headers.get('Authorization') == 'Bearer test-secret'
            if self.path == '/v1/realm' and auth:
                body, ctype = (b'{"characters":[{"id":"%s","name":"Slippy","playing":true,"updatedAt":1,"seq":%d}],"max":3}' % (REALM_ID.encode(), REALM['seq'])), 'application/json'
            elif self.path == f'/v1/realm/{REALM_ID}/data' and auth:
                REALM['data_gets'] += 1
                body, ctype = REALM['body'], 'application/octet-stream'
            elif self.path.startswith('/v1/'):
                self.send_response(401); self.end_headers(); return
            else:
                body, ctype = b'<!doctype html><title>fake DFO</title><p>DFO Online</p>', 'text/html'
            self.send_response(200)
            self.send_header('Content-Type', ctype)
            self.end_headers()
            self.wfile.write(body)
    httpd = socketserver.TCPServer(('127.0.0.1', 0), H)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return f'http://127.0.0.1:{httpd.server_address[1]}'


def run_sync(base):
    """The Sync bookmark, end to end: js/bookmarklet.js run on a fake DFO page sends the quests to the guide."""
    dfo = serve_fake_dfo()
    other = serve_fake_dfo()   # a different origin that must not be listened to
    guide = f'{base}?dfo={dfo}'
    code = (SITE / 'js' / 'bookmarklet.js').read_text()
    code = code.replace("GUIDE = 'https://daggerfall.slippylabs.com/'", f"GUIDE = {guide!r}").replace(r"DFO_HOST = /(^|\.)daggerfalljs\.dev$/", r"DFO_HOST = /^127\.0\.0\.1$/")
    assert guide in code and r'/^127\.0\.0\.1$/' in code, 'bookmarklet constants not replaced'
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for kind in ['realm', 'local']:
            REALM.update(seq=1, body=REALM_SAVE, data_gets=0)
            ctx = browser.new_context(viewport={'width': 1280, 'height': 900})
            page = ctx.new_page()
            page.goto(dfo + '/')
            page.evaluate('window.__dgSyncMs = 700')   # the watcher's minute, shortened for the test
            if kind == 'realm':
                page.evaluate(f"localStorage.setItem('dagger.account.session', JSON.stringify({{secret: 'test-secret'}})); localStorage.setItem('dagger.account.service', {dfo!r})")
            else:
                page.evaluate("([s]) => { localStorage.setItem('dagger.save.0', s); localStorage.setItem('dagger.saveinfo.0', JSON.stringify({characterName: 'Slippy', saveName: 'QuickSave', dateAndTime: {realTime: 5, gameTime: 526410}})); }", [REALM_SAVE.decode()])
            with page.expect_popup() as pop:
                page.evaluate(code)
            g = pop.value
            g.wait_for_selector('#mine-list .dg-mine-now', timeout=20000)
            status = g.inner_text('#sync-status')
            check(g.locator('#mine-list .dg-mine-now').count() == 2 and 'Live' in status,
                  f'[sync/{kind}] the bookmark sends both quests to the guide ({status[:40]})')
            check('Wickford Residence' in g.inner_text('#mine-list'), f'[sync/{kind}] synced quests carry their exact places')
            # live: the game saves again (the delivery done); the guide follows without another click
            g.click('.hud-tab[data-tab="towns"]')
            if kind == 'realm':
                page.wait_for_timeout(2000)
                check(REALM['data_gets'] == 1, f'[sync/realm] an unchanged save is not fetched again ({REALM["data_gets"]} fetch)')
                REALM.update(seq=2, body=REALM_LATER)
            else:
                page.evaluate("([s]) => { localStorage.setItem('dagger.save.0', s); localStorage.setItem('dagger.saveinfo.0', JSON.stringify({characterName: 'Slippy', saveName: 'QuickSave', dateAndTime: {realTime: 9, gameTime: 527010}})); }", [REALM_LATER.decode()])
            g.wait_for_function('document.querySelectorAll("#mine-list .dg-mine-now").length === 1', timeout=15000)
            check(g.evaluate('state => !document.querySelector("#tab-towns").hidden', None), f'[sync/{kind}] live update leaves the page where the player is (towns tab)')
            check('Lycanthrope' in g.inner_text('#mine-list') and 'Delivery' not in g.inner_text('#mine-list'),
                  f'[sync/{kind}] live: the finished delivery drops off by itself')
            page.evaluate(code)   # a second click: the same guide window, no popup
            page.wait_for_timeout(1500)
            check(page.evaluate('window.__dgSyncCount') == 1 and g.locator('#mine-list .dg-mine-now').count() == 1,
                  f'[sync/{kind}] a second click resends to the same window and starts no second watcher')
            ctx.close()
        # a page on another origin cannot push quests into the guide
        ctx = browser.new_context()
        page = ctx.new_page()
        page.goto(other + '/')
        with page.expect_popup() as pop:
            page.evaluate(f"window.w = window.open({(guide + '#sync')!r}, 'g')")
        g = pop.value
        g.wait_for_selector('#sync-status:not([hidden])')
        page.evaluate("[0, 300, 900, 1500].forEach(t => setTimeout(() => w.postMessage({type: 'dg-sync', payload: {snap: {quest: {machine: {quests: []}}}}}, '*'), t))")
        page.wait_for_timeout(2500)
        check('Waiting' in g.inner_text('#sync-status') and not g.locator('#mine-list .dg-mine-now').count(),
              '[sync] a message from any other origin is ignored')
        browser.close()


POSTMAN = (Path(__file__).resolve().parent / 'fixtures' / 'postman-save.json').read_text()
FAKE_PACK = """(page) => { document.querySelector('.pack-shell')?.remove(); const d = document.createElement('div'); d.className = 'pack-shell';
  const tabs = ['Weapons', 'Misc'].map(t => `<button class="packtab${t === page ? ' on' : ''}">${t}<span class="count">4</span></button>`).join('');
  const rows = page !== 'Misc' ? '<button class="itemrow"><span class="itemname"><span>Dagger</span></span></button>'
    : ['Parchment', 'Parchment', 'Letter: Lysausa Greenhouse ', 'Parchment'].map(n => `<button class="itemrow"><span class="itemname"><span>${n}</span></span></button>`).join('');
  d.innerHTML = `<section class="packcats"><div class="packtabs">${tabs}</div></section><section class="packcol">${rows}</section>`; document.body.append(d); }"""


def run_helper(base):
    """The in-game helper: the bookmark loads js/helper.js into DFO's page; the guide sends it the Postman's step; with
    the pack open it lights the Misc button, then only the quest letter among identical parchments."""
    dfo = serve_fake_dfo()
    guide = f'{base}?dfo={dfo}'
    code = (SITE / 'js' / 'bookmarklet.js').read_text()
    code = code.replace("GUIDE = 'https://daggerfall.slippylabs.com/'", f"GUIDE = {guide!r}").replace(r"DFO_HOST = /(^|\.)daggerfalljs\.dev$/", r"DFO_HOST = /^127\.0\.0\.1$/")
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={'width': 1280, 'height': 900})
        page = ctx.new_page()
        page.goto(dfo + '/')
        page.evaluate("([s]) => { localStorage.setItem('dagger.save.0', s); localStorage.setItem('dagger.saveinfo.0', JSON.stringify({characterName: 'Slippy', saveName: 'QuickSave', dateAndTime: {realTime: 5, gameTime: 523530}})); }", [POSTMAN])
        with page.expect_popup():
            page.evaluate(code)
        page.wait_for_function('window.__dgHelper && window.__dgHelper.state().quests.length === 1', timeout=20000)
        panel = page.locator('#dg-helper .p').inner_text()
        check('The Postman' in panel and 'Letter: Lysausa Greenhouse' in panel and "The Queen's Helm" in panel and 'F6' in panel,
              f'[helper] the panel shows the Postman step over the game ({panel.splitlines()[1][:60]})')
        page.evaluate(FAKE_PACK, 'Weapons')
        page.wait_for_function("document.querySelectorAll('.packtab.dg-hl').length === 1")
        check(page.inner_text('.packtab.dg-hl').startswith('Misc') and 'glowing Misc button' in page.locator('#dg-helper .p').inner_text(),
              '[helper] pack open on another page: the Misc button glows')
        page.evaluate(FAKE_PACK, 'Misc')
        page.wait_for_function("document.querySelectorAll('.itemrow.dg-hl').length === 1")
        lit = page.evaluate("[...document.querySelectorAll('.itemrow')].map(r => r.classList.contains('dg-hl'))")
        check(lit == [False, False, True, False] and page.locator('.packtab.dg-hl').count() == 0 and 'glowing gold' in page.locator('#dg-helper .p').inner_text(),
              f'[helper] on Misc: only the quest letter glows among identical parchments ({lit})')
        page.screenshot(path=str(SHOTS / 'helper.png'))
        page.locator('#dg-helper .x').click()
        check(not page.locator('#dg-helper').is_visible(), '[helper] × closes the panel')
        page.evaluate(code)   # the second click: the same guide window, no popup
        page.wait_for_timeout(500)
        check(page.locator('#dg-helper').is_visible() and page.evaluate("document.querySelectorAll('#dg-helper').length") == 1,
              '[helper] the bookmark brings it back, one panel only')
        browser.close()


local = not (len(sys.argv) > 1 and sys.argv[1].startswith('http'))
base = serve() if local else sys.argv[1]
run(base, 1280, 900, False)
run(base, 390, 844, True)
if local:
    run_sync(base)
    run_helper(base)
print(f'\n{sum(results)} passed, {len(results) - sum(results)} failed')
sys.exit(0 if all(results) else 1)
