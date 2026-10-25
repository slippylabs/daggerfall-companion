// Recognises which quest a pasted journal entry (or quest-giver speech) comes from, and reads the
// names, places and days the game filled into its blanks. Each quest message is a template of fixed
// text and typed blanks (tools/build-quests.mjs); a template becomes a regular expression and the
// blanks become capture groups.
import { loadQuests } from './data.js?v=16';

const MIN_LITERAL = 24;
// A Daggerfall date ("Morndas, 4th of Morning Star, 3E 405"), else any short run of text
const DATE = "(?:(?:[A-Za-z]+,\\s+)?\\d{1,2}(?:st|nd|rd|th)?\\s+of\\s+[A-Za-z' ]+?,\\s*3E\\s*\\d{1,3}|[^\\n]{1,90}?)";     // a template with less fixed text than this matches too much to trust
let compiled = null;

const norm = s => s.replace(/[’‘`]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function compile(q, t) {
  let src = '', literal = 0;
  const slots = [];
  const parts = t.parts;
  for (let i = 0; i < parts.length; i++) {
    let p = parts[i];
    if (typeof p === 'string') {
      const text = norm(p);
      literal += text.replace(/[^A-Za-z]/g, '').length;
      // whitespace (kept on both sides of a blank) and the space before punctuation are loose:
      // the game reflows lines
      // a space beside a blank is a real space, or a name could end inside the next word
      if (!text) src += '\\s+';
      else if (/^\s/.test(p)) src += /^[,.;:!?]/.test(text) ? '\\s*' : '\\s+';
      if (text) src += text.split(/\s+/).map(esc).join('\\s+').replace(/\\s\+([,.;:!?])/g, '\\s*$1');
      if (/\s$/.test(p) && text) src += '\\s+';
      continue;
    }
    if (p.m === 'qdt' || p.m === 'qdat' || p.m === 'dat') {
      // the date: "%qdt:" at the start is optional (people copy without it); mid-sentence it is a blank
      const next = parts[i + 1];
      if (typeof next === 'string' && /^\s*:/.test(next)) {
        parts[i + 1] = next.replace(/^\s*:\s*/, '');
        src += '(?:[^\\n]{0,90}?:\\s*)?';
      } else src += DATE;
      continue;
    }
    if (p.m) { src += /^g/.test(p.m) ? '(?:\\w+)' : '(?:[^.;!?\\n]{1,60}?)'; continue; }
    if (p.c) { src += '(\\d{1,3})'; slots.push({ c: p.c }); continue; }
    src += "([A-Z0-9][^.;:!?\\n]{0,60}?)";
    slots.push({ s: p.s, n: p.n });
  }
  if (literal < MIN_LITERAL) return null;
  return { q, t, re: new RegExp(src, 'i'), slots, literal, words: wordsOf(parts) };
}

function wordsOf(parts) {
  return parts.filter(p => typeof p === 'string').join(' ').toLowerCase().match(/[a-z']+/g) || [];
}

export function compileAll(quests) {
  compiled = [];
  for (const q of quests) for (const t of q.templates) {
    const c = compile(q, { ...t, parts: [...t.parts] });
    if (c) compiled.push(c);
  }
  return compiled;
}

async function ready() {
  return compiled || compileAll(await loadQuests());
}

// Exact match: every fixed word in order, blanks captured
function exact(c, text) {
  const m = c.re.exec(text);
  if (!m) return null;
  const names = {}, days = {};
  c.slots.forEach((slot, k) => {
    const v = m[k + 1]?.trim();
    if (!v) return;
    if (slot.c) days[slot.c] = v;
    else {
      names[slot.s] ||= {};
      names[slot.s][slot.n] ||= v;
    }
  });
  return { names, days, score: c.literal };
}

// Fuzzy fallback: share of the template's fixed words found in order (longest common subsequence)
function lcsRatio(a, b) {
  if (!a.length) return 0;
  let prev = new Uint16Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Uint16Array(b.length + 1);
    for (let j = 1; j <= b.length; j++)
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    prev = cur;
  }
  return prev[b.length] / a.length;
}

// -> { quest, template, names, days, partial, others: [quest...] } or null
export async function recognise(input) {
  return recogniseWith(await ready(), input);
}

export function recogniseWith(list, input) {
  const text = norm(input);
  const hits = [];
  for (const c of list) {
    const r = exact(c, text);
    if (r) hits.push({ c, ...r });
  }
  if (hits.length) {
    hits.sort((a, b) => b.score - a.score || Object.keys(b.names).length - Object.keys(a.names).length);
    const best = hits[0];
    // Merge the blanks of every matched message of the same quest (a paste may hold several entries)
    const names = {}, days = {};
    for (const h of hits.filter(h => h.c.q === best.c.q)) {
      for (const [sym, v] of Object.entries(h.names)) names[sym] = { ...v, ...names[sym] };
      Object.assign(days, { ...h.days, ...days });
    }
    const others = [...new Set(hits.filter(h => h.c.q !== best.c.q && h.score >= best.score * 0.9).map(h => h.c.q))];
    return { quest: best.c.q, template: best.c.t, names, days, partial: false, others };
  }
  const words = text.toLowerCase().match(/[a-z']+/g) || [];
  if (words.length < 6) return null;
  let best = null;
  for (const c of list) {
    if (c.words.length < 8) continue;
    const r = lcsRatio(c.words, words);
    if (!best || r > best.r) best = { c, r };
  }
  return best && best.r >= 0.7
    ? { quest: best.c.q, template: best.c.t, names: {}, days: {}, partial: true, others: [] }
    : null;
}
