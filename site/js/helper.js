// The in-game helper: loaded into DFO Online's page by the "\u2694 Sync quests" bookmark (js/bookmarklet.js). It shows
// a small panel over the game with each quest's step, and lights up the inventory tile the step needs - the pack
// shows pictures only, and a quest letter's picture is the same as every plain parchment's. The steps come from the
// guide's tab (app.js tellHelper, myquests.js helperPayload) by postMessage, after every sync.
// It only shows things: it never clicks, moves an item or presses a key for the player.
// A classic script, not a module: a cross-origin module would need CORS on this site.
(() => {
  if (window.__dgHelper) { window.__dgHelper.show(); return; }
  const GUIDE = new URL(document.currentScript?.src || 'https://daggerfall.slippylabs.com/js/helper.js').origin;
  const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private window */ } } };
  let quests = [], at = 0, pick = store.get('dg.helper.quest'), small = store.get('dg.helper.small') === '1';

  // ---- the panel, in a shadow root so the game's styles and the panel's never meet ----
  const host = document.createElement('div');
  host.id = 'dg-helper';
  host.style.cssText = 'position:fixed;top:64px;right:12px;z-index:2147483647;';
  const saved = (() => { try { return JSON.parse(store.get('dg.helper.pos')); } catch { return null; } })();
  if (saved && saved.x >= 0 && saved.y >= 0) Object.assign(host.style, { left: `${Math.min(saved.x, innerWidth - 80)}px`, top: `${Math.min(saved.y, innerHeight - 40)}px`, right: 'auto' });
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    :host { all: initial; }
    .p { width: 340px; max-width: calc(100vw - 24px); max-height: calc(100vh - 80px); overflow: auto; box-sizing: border-box;
      background: #2a2016; color: #f3e6c8; border: 2px solid #c9a43d; border-radius: 8px; box-shadow: 0 6px 24px rgba(0,0,0,.6);
      font: 15px/1.4 Georgia, 'Times New Roman', serif; }
    .h { display: flex; align-items: center; gap: 6px; padding: 6px 8px; background: #3b2d1d; border-bottom: 1px solid #c9a43d; cursor: move; user-select: none; }
    .t { flex: 1; font-weight: bold; color: #f2cd52; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    button { all: unset; cursor: pointer; min-width: 26px; height: 26px; text-align: center; border-radius: 4px; color: #f3e6c8; font: 15px/26px sans-serif; }
    button:hover { background: #5a4630; }
    .b { padding: 10px 12px; }
    .now { font-size: 18px; font-weight: bold; color: #fff; margin: 0 0 4px; }
    .where { color: #f2cd52; margin: 0 0 8px; }
    ol { margin: 6px 0; padding-left: 22px; } li { margin: 4px 0; }
    .avoid { margin: 8px 0 0; padding: 6px 8px; border-left: 3px solid #d0453a; background: rgba(208,69,58,.15); }
    .avoid b { color: #ff7a6e; }
    .then { margin: 8px 0 0; font-style: italic; opacity: .85; }
    .hint { margin: 8px 0 0; padding: 6px 8px; background: rgba(242,205,82,.15); border-left: 3px solid #f2cd52; }
    .f { padding: 4px 12px 8px; font-size: 12px; opacity: .7; }
    .warn { margin: 0 0 8px; padding: 6px 8px; border-radius: 4px; background: #8e1f17; color: #fff; font-weight: bold; }
    .also { margin: 8px 0 0; padding: 6px 8px; border-left: 3px solid #d0453a; background: rgba(208,69,58,.15); cursor: pointer; }
    .p.urgent { border-color: #d0453a; } .p.urgent .h { background: #5a1f17; border-bottom-color: #d0453a; }
    .small .b, .small .f { display: none; }
  </style>
  <div class="p"><div class="h"><button class="prev" title="Previous quest">\u2039</button><span class="t">Quest helper</span>
  <button class="next" title="Next quest">\u203a</button><button class="min" title="Shrink / grow">\u2013</button><button class="x" title="Close (click the bookmark to bring it back)">\u00d7</button></div>
  <div class="b"></div><div class="f"></div></div>`;
  const $ = s => root.querySelector(s);
  const panel = $('.p');
  (document.body || document.documentElement).append(host);

  // the panel's buttons never keep the keyboard: the game's keys must still reach the game
  const tap = (sel, fn) => $(sel).addEventListener('click', e => { e.stopPropagation(); fn(); e.currentTarget.blur(); });
  // the quest picked with the arrows; else the one running out of time soonest
  const current = () => quests.find(q => q.file === pick) || [...quests].sort((a, b) => (a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9))[0] || null;
  const step = d => { if (quests.length < 2) return; const i = quests.indexOf(current()); pick = quests[(i + d + quests.length) % quests.length].file; store.set('dg.helper.quest', pick); draw(); mark(); };
  tap('.prev', () => step(-1));
  tap('.next', () => step(1));
  tap('.min', () => { small = !small; store.set('dg.helper.small', small ? '1' : '0'); draw(); });
  tap('.x', () => { host.style.display = 'none'; });

  // drag by the title bar
  $('.h').addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    const r = host.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
    const move = ev => Object.assign(host.style, { left: `${Math.max(0, Math.min(innerWidth - 60, ev.clientX - dx))}px`, top: `${Math.max(0, Math.min(innerHeight - 30, ev.clientY - dy))}px`, right: 'auto' });
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); store.set('dg.helper.pos', JSON.stringify({ x: parseInt(host.style.left, 10), y: parseInt(host.style.top, 10) })); };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    e.preventDefault();
  });

  // ---- deadlines: the guide's warning (myquests.js deadline), the panel turns red ----
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const urgency = q => q?.warn || null;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  let invHint = '';
  function draw() {
    panel.classList.toggle('small', small);
    $('.min').textContent = small ? '+' : '\u2013';
    const q = current();
    $('.prev').style.visibility = $('.next').style.visibility = quests.length > 1 ? 'visible' : 'hidden';
    if (!q) {
      $('.t').textContent = 'Quest helper';
      $('.b').innerHTML = '<p>Waiting for your quests from the guide\u2026</p><p>Keep the guide\'s tab open: it sends each quest\'s next step here.</p>';
      $('.f').textContent = '';
      return;
    }
    $('.t').textContent = `${urgency(q) ? '\u26a0 ' : ''}${q.title}${quests.length > 1 ? ` (${quests.indexOf(q) + 1}/${quests.length})` : ''}`;
    panel.classList.toggle('urgent', !!urgency(q));
    // another quest running out of time, one click away
    const other = quests.find(x => x !== q && urgency(x));
    $('.b').innerHTML = (urgency(q) ? `<p class="warn">${esc(urgency(q))}</p>` : '')
      + `<p class="now">${esc(q.now)}.</p>${q.where ? `<p class="where">\u25b6 ${esc(q.where)}</p>` : ''}`
      + (q.steps.length ? `<ol>${q.steps.map(s => `<li>${esc(s)}.</li>`).join('')}</ol>` : '')
      + (invHint ? `<p class="hint">${esc(invHint)}</p>` : '')
      + (q.avoid ? `<p class="avoid"><b>Don't</b> ${esc(q.avoid)}: it spoils the quest.</p>` : '')
      + (q.then ? `<p class="then">Then: ${esc(q.then)}.</p>` : '')
      + (!q.steps.length && q.journal ? `<p class="then">Journal: \u201c${esc(q.journal)}\u201d</p>` : '')
      + (other ? `<p class="also" data-file="${esc(other.file)}">\u26a0 Also running out: <b>${esc(other.title)}</b> (${plural(other.daysLeft, 'day')} left). Click to see it.</p>` : '');
    const also = $('.also');
    if (also) also.addEventListener('click', e => { e.stopPropagation(); pick = also.dataset.file; store.set('dg.helper.quest', pick); draw(); mark(); });
    const mins = Math.round((Date.now() - at) / 60000);
    $('.f').textContent = `${q.daysLeft != null ? `${q.daysLeft} day${q.daysLeft === 1 ? '' : 's'} left \u00b7 ` : ''}step ${q.step[0]} of ${q.step[1]} \u00b7 updated ${mins < 1 ? 'just now' : `${mins} min ago`} (the game saves every few minutes)`;
  }
  setInterval(draw, 30000);

  // ---- the glow on the inventory tile (DFO's enhanced pack: .itemrow tiles, each with its name hidden in
  // .itemname, and the page buttons .packtab "Misc 3") ----
  const css = document.createElement('style');
  css.textContent = `@keyframes dg-glow { 0%,100% { box-shadow: 0 0 6px 2px #f2cd52, inset 0 0 0 3px #f2cd52; } 50% { box-shadow: 0 0 18px 7px #f2cd52, inset 0 0 0 3px #fff3b0; } }
    .dg-hl { animation: dg-glow 1s ease-in-out infinite !important; outline: 3px solid #f2cd52 !important; outline-offset: 1px !important; position: relative; z-index: 2; }`;
  document.head.append(css);
  const nameOf = row => (row.querySelector('.itemname > span')?.textContent || '').replace(/\s*\u00d7\d+\s*$/, '').trim();
  let seen = new WeakSet();
  function mark() {
    const q = current(), want = new Set((q?.tiles || []).map(s => s.trim()));
    const rows = [...document.querySelectorAll('.itemrow')];
    // the exact name; failing that a quest letter (the game may word its signature differently): any "Letter: \u2026"
    let hits = rows.filter(r => want.has(nameOf(r)));
    if (!hits.length && [...want].some(s => s.startsWith('Letter:'))) hits = rows.filter(r => nameOf(r).startsWith('Letter:'));
    for (const r of rows) r.classList.toggle('dg-hl', hits.includes(r));
    for (const r of hits) if (!seen.has(r)) { seen.add(r); try { r.scrollIntoView({ block: 'nearest' }); } catch { /* detached */ } }
    const tabs = [...document.querySelectorAll('.packtab')];
    const onPage = tabs.find(t => t.classList.contains('on'));
    const label = t => (t.firstChild?.textContent || '').trim();
    for (const t of tabs) t.classList.toggle('dg-hl', !hits.length && !!q?.page && label(t) === q.page && t !== onPage);
    // a word in the panel while the pack is open
    const open = !!document.querySelector('.pack-shell') && tabs.length > 0;
    const hint = !want.size || !open ? '' : hits.length ? 'It is glowing gold in your inventory now.'
      : onPage && label(onPage) === q.page ? `Scroll down the ${q.page} list: it glows when it comes into view.`
        : `Click the glowing ${q.page} button.`;
    if (hint !== invHint) { invHint = hint; draw(); }
  }
  let queued = false;
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; mark(); }); } })
    .observe(document.documentElement, { childList: true, subtree: true });

  // ---- the steps, from the guide's tab ----
  addEventListener('message', e => {
    if (e.origin !== GUIDE || e.data?.type !== 'dg-helper') return;
    quests = Array.isArray(e.data.quests) ? e.data.quests : [];
    at = e.data.at || Date.now();
    seen = new WeakSet();
    draw(); mark();
  });
  const hello = () => { try { window.__dgSync?.w?.postMessage('dg-helper-hello', GUIDE); } catch { /* no guide tab */ } };
  window.__dgHelper = { show: () => { host.style.display = ''; hello(); }, state: () => ({ quests, pick, invHint }) };
  draw();
  hello();
})();
