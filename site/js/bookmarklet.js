// The "⚔ Sync quests" bookmark (sync.html turns this file into the bookmark's javascript: link). Run on DFO
// Online's page, it reads the player's save there and hands this guide only the quest part:
//   1. an online realm character: DFO's own account service (the session DFO keeps in localStorage,
//      dagger.account.session / .service), GET /v1/realm then /v1/realm/<id>/data - the login never leaves DFO's page;
//   2. else the newest saved game in this browser (dagger.save.<n> by dagger.saveinfo.<n> realTime).
// The guide's window is opened first (a popup must open on the click itself), then sent the quests by postMessage,
// pinned to the guide's origin, once it says it is ready. Then it keeps watching: every minute it asks again and
// sends a fresh copy only when the save changed (the realm's `seq`, a local save's time), until the guide closes.
(async () => {
  const GUIDE = 'https://daggerfall.slippylabs.com/', DFO_HOST = /(^|\.)daggerfalljs\.dev$/;
  if (!DFO_HOST.test(location.hostname)) {
    if (confirm('Click this bookmark while DFO Online is open. Open DFO Online now?')) location.href = 'https://daggerfalljs.dev/play/';
    return;
  }
  const origin = new URL(GUIDE).origin;
  const w = window.open(GUIDE + '#sync', 'dg-guide');
  if (!w) { alert('Your browser blocked the guide window. Allow pop-ups for daggerfalljs.dev and click again.'); return; }
  // a second click while a watcher runs: it sends again to the (re)opened window, no second watcher
  const live = window.__dgSync;
  if (live) {
    // the same window, still open and listening: just resend; a window opened afresh says "ready" first
    if (live.w !== w || w.closed) { live.w = w; live.ready = false; }
    live.last = null;
    try { w.focus(); } catch { /* not ours to focus */ }
    live.tick();
    return;
  }

  const ls = localStorage, read = k => { try { return JSON.parse(ls.getItem(k)); } catch { return null; } };
  const S = window.__dgSync = { w, ready: false, last: null, payload: null, watchers: (window.__dgSyncCount = (window.__dgSyncCount || 0) + 1) };
  const send = () => { if (S.ready && S.payload && !S.w.closed) S.w.postMessage({ type: 'dg-sync', payload: S.payload, live: true }, origin); };
  addEventListener('message', e => { if (e.origin === origin && e.data === 'dg-ready' && !S.ready) { S.ready = true; send(); } });

  // the current save: { stamp, snap, info } (stamp tells whether it changed since the last send)
  async function current() {
    let note = '';
    try {
      const session = read('dagger.account.session');
      const base = (ls.getItem('dagger.account.service') || 'https://daggerfall-accounts.mackcothran.workers.dev').replace(/\/$/, '');
      if (session && session.secret) {
        const headers = { Authorization: 'Bearer ' + session.secret };
        const list = await (await fetch(base + '/v1/realm', { headers })).json();
        const c = (list.characters || []).slice().sort((a, b) => (b.playing - a.playing) || ((b.updatedAt || 0) - (a.updatedAt || 0)))[0];
        if (c) {
          const stamp = 'realm:' + c.id + ':' + c.seq;
          if (stamp === S.last) return { stamp };
          const r = await fetch(base + '/v1/realm/' + c.id + '/data', { headers });
          if (r.ok) {
            const snap = JSON.parse(await r.text());
            return { stamp, snap, info: { characterName: c.name, saveName: 'Online', dateAndTime: { gameTime: snap.classicMinutes } } };
          }
          note = 'online save: HTTP ' + r.status;
        }
      }
    } catch (e) { note = 'online save: ' + e.message; }
    let best = -1, bestT = -Infinity, info = null;
    for (let i = 0; i < ls.length; i++) {
      const m = /^dagger\.saveinfo\.(\d+)$/.exec(ls.key(i));
      const card = m && read(ls.key(i));
      const t = card && card.dateAndTime ? (card.dateAndTime.realTime ?? card.dateAndTime.gameTime ?? 0) : -1;
      if (card && t > bestT) { bestT = t; best = +m[1]; info = card; }
    }
    if (best < 0) return { note };
    const stamp = 'local:' + best + ':' + bestT;
    if (stamp === S.last) return { stamp };
    return { stamp, snap: read('dagger.save.' + best), info, note };
  }

  S.tick = async () => {
    if (S.w.closed) return;
    const c = await current();
    if (c.stamp && c.stamp === S.last) return;   // nothing new
    if (!c.snap || !c.snap.quest) {
      if (!S.last) { S.payload = { error: 'No save with quests found in this browser' + (c.note ? ' (' + c.note + ')' : '') + '. Save your game (F9) and click again.' }; send(); }
      return;
    }
    const keep = ['quest', 'world', 'classicMinutes', 'items', 'wagonItems', 'bagItems', 'otherItems'];
    S.payload = { snap: Object.fromEntries(keep.filter(k => k in c.snap).map(k => [k, c.snap[k]])), info: c.info };
    S.last = c.stamp;
    send();
  };
  await S.tick();
  const every = window.__dgSyncMs || 60000, until = Date.now() + 6 * 3600 * 1000;
  const timer = setInterval(() => {
    if (S.w.closed || Date.now() > until) { clearInterval(timer); window.__dgSync = null; return; }
    S.tick();
  }, every);
})();
