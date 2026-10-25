// The "⚔ Sync quests" bookmark (sync.html turns this file into the bookmark's javascript: link). Run on DFO
// Online's page, it reads the player's save there and hands this guide only the quest part:
//   1. an online realm character: DFO's own account service (the session DFO keeps in localStorage,
//      dagger.account.session / .service), GET /v1/realm then /v1/realm/<id>/data - the login never leaves DFO's page;
//   2. else the newest saved game in this browser (dagger.save.<n> by dagger.saveinfo.<n> realTime).
// The guide's window is opened first (a popup must open on the click itself), then sent the quests by postMessage,
// pinned to the guide's origin, once it says it is ready.
(async () => {
  const GUIDE = 'https://daggerfall.slippylabs.com/', DFO_HOST = /(^|\.)daggerfalljs\.dev$/;
  if (!DFO_HOST.test(location.hostname)) {
    if (confirm('Click this bookmark while DFO Online is open. Open DFO Online now?')) location.href = 'https://daggerfalljs.dev/play/';
    return;
  }
  const origin = new URL(GUIDE).origin;
  const w = window.open(GUIDE + '#sync', 'dg-guide');
  if (!w) { alert('Your browser blocked the guide window. Allow pop-ups for daggerfalljs.dev and click again.'); return; }
  let ready = false, payload = null;
  const send = () => { if (ready && payload) w.postMessage({ type: 'dg-sync', payload }, origin); };
  addEventListener('message', e => { if (e.origin === origin && e.data === 'dg-ready') { ready = true; send(); } });

  const ls = localStorage, read = k => { try { return JSON.parse(ls.getItem(k)); } catch { return null; } };
  let snap = null, info = null, note = '';
  try {
    const session = read('dagger.account.session');
    const base = (ls.getItem('dagger.account.service') || 'https://daggerfall-accounts.mackcothran.workers.dev').replace(/\/$/, '');
    if (session && session.secret) {
      const headers = { Authorization: 'Bearer ' + session.secret };
      const list = await (await fetch(base + '/v1/realm', { headers })).json();
      const chars = (list.characters || []).slice().sort((a, b) => (b.playing - a.playing) || ((b.updatedAt || 0) - (a.updatedAt || 0)));
      const c = chars[0];
      if (c) {
        const r = await fetch(base + '/v1/realm/' + c.id + '/data', { headers });
        if (r.ok) {
          snap = JSON.parse(await r.text());
          info = { characterName: c.name, saveName: 'Online', dateAndTime: { gameTime: snap.classicMinutes } };
        } else note = 'online save: HTTP ' + r.status;
      }
    }
  } catch (e) { note = 'online save: ' + e.message; }
  if (!snap) {
    let best = -1, bestT = -Infinity;
    for (let i = 0; i < ls.length; i++) {
      const m = /^dagger\.saveinfo\.(\d+)$/.exec(ls.key(i));
      const card = m && read(ls.key(i));
      const t = card && card.dateAndTime ? (card.dateAndTime.realTime ?? card.dateAndTime.gameTime ?? 0) : -1;
      if (card && t > bestT) { bestT = t; best = +m[1]; info = card; }
    }
    if (best >= 0) snap = read('dagger.save.' + best);
  }
  if (!snap || !snap.quest) {
    payload = { error: 'No save with quests found in this browser' + (note ? ' (' + note + ')' : '') + '. Save your game (F9) and click again.' };
  } else {
    const keep = ['quest', 'world', 'classicMinutes', 'items', 'wagonItems', 'bagItems', 'otherItems'];
    payload = { snap: Object.fromEntries(keep.filter(k => k in snap).map(k => [k, snap[k]])), info };
  }
  send();
})();
