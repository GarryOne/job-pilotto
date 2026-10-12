// Write-back of the ladder (docs/superpowers/specs/2026-10-10-ai-ladder.md "Learning"): what a higher rung (3 digest, 4 picture, 5 takeover, 6 person) decided AND the page confirmed becomes the
// kept answer for the page shape, so the next visit is free; one miss drops it. Only fixed values are ever stored: a shape (host + path template, no query: page-kind.js kindKey), a kind,
// an outcome class (digest.js OUTCOMES), a rung, a signal and counts. There is no field for text: sentences, addresses, URLs and names cannot be stored, whatever a caller passes.
// An email outcome keeps its class only (a hint that this shape asks for addresses: lookup flags it `askAgain`, the address is never kept). The flow core calls record/lookup/hit/miss
// (the wiring is its own change); this file owns the store. Guard: desktop/test/ladder-learning.test.js.
// The fast tier's decisions (0 structure, 1 kept, 2 sketch) are kept by rung 1's own store (rung1-kept.js); what the page confirmed of them is only COUNTED here (confirm), so real use,
// the CI pool and the recorded replays feed the same counts (spec docs/superpowers/specs/2026-10-12-one-next-move.md, phase 1). A count never answers a page: lookup reads `kept` only.
//
// File (ladder-learning.json, a cache: deleting it only means asking again):
//   {"kept": {"<shape>": {"by": 3, "outcome": "form", "kind": "posting", "signal": "confident", "hits": 2, "at": "<ISO time>"}},
//    "tally": {"<shape>": {"rung": 3, "kind": "posting", "outcome": "form", "hits": 2, "misses": 1}}}      // the tally survives a drop: it is what counts() reports
// counts() -> the learned counts for the token-gated pack path (lib/recipes.js createReporter: one more map, sent in the batch; the site aggregates with k>=3 and fixed lists, never a second delivery path):
//   [{"shape": "jobs.example.ch/careers/*|3-7", "rung": 3, "kind": "posting", "outcome": "form", "hits": 2, "misses": 1}, ...]   // fixed values and integers only, sorted by shape
import fs from 'node:fs';
import {CAPS} from './rung4-picture.js';
import {OUTCOMES} from './rung3-digest.js';
import {KINDS} from './rung2-sketch.js';

const SIGNALS = ['confident', 'unsure', 'contradicted', 'stalled', 'failed', 'blind'];   // as extension/ladder/core.js SIGNALS (a classic script, not importable here)
const MIN_RUNG = 3, MAX_RUNG = 6, MAX_SHAPES = 500;   // kept: rungs 3-6; counted: 0-6
export const SHAPE = /^[a-z0-9._-]{1,80}(\/[a-z0-9._*-]{0,60}){0,8}\|[a-z0-9+-]{1,12}$/;   // host / path template | build (rung1-kept.js pageBuild: 'pft8+'): no query, no space, no @, no sentence
const count = value => (Number.isInteger(value) && value >= 0 ? Math.min(value, 1e6) : 0);

// Rung 4 is escalate.js's own limit; rung 3 is a proposal (owner to confirm): the small model is cheap and its answer is kept per shape, so a little more than the picture's. Other rungs: no cap of this module's.
export const RUNG3_CAPS = {perShape: 4, perDay: 40};
export const capsFor = rung => (rung === 4 ? {perShape: CAPS.perShape, perDay: CAPS.perDay} : rung === 3 ? {...RUNG3_CAPS} : null);

const cleanEntry = raw => {
  const by = raw?.by, kept = {by, outcome: raw?.outcome, kind: raw?.kind, signal: raw?.signal, hits: count(raw?.hits), at: typeof raw?.at === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(raw.at) ? raw.at : ''};
  return Number.isInteger(by) && by >= MIN_RUNG && by <= MAX_RUNG && OUTCOMES.includes(kept.outcome) && KINDS.includes(kept.kind) && SIGNALS.includes(kept.signal) ? kept : null;
};
const cleanTally = raw => (Number.isInteger(raw?.rung) && raw.rung >= 0 && raw.rung <= MAX_RUNG && OUTCOMES.includes(raw?.outcome)
  ? {rung: raw.rung, kind: KINDS.includes(raw?.kind) ? raw.kind : '', outcome: raw.outcome, hits: count(raw.hits), misses: count(raw.misses)} : null);   // kind '': a file from before it was counted

// The store: loaded once, written through (a read-only disk keeps it for this run). A missing, corrupt or odd file is an empty store.
export function ladderStore(file) {
  const data = {kept: {}, tally: {}};
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const [shape, entry] of Object.entries(raw?.kept && typeof raw.kept === 'object' ? raw.kept : {})) { const clean = SHAPE.test(shape) && cleanEntry(entry); if (clean) data.kept[shape] = clean; }
    for (const [shape, entry] of Object.entries(raw?.tally && typeof raw.tally === 'object' ? raw.tally : {})) { const clean = SHAPE.test(shape) && cleanTally(entry); if (clean) data.tally[shape] = clean; }
  } catch { /* none yet, or unreadable: asked again */ }
  return {data, save: () => { try { fs.writeFileSync(file, JSON.stringify(data)); } catch { /* read-only: asked again next time */ } }};
}

// Keep a decision for the shape. Only a VERIFIED (the caller says true: the page moved on as expected, or the person did not override it) decision of rung 3 or higher, with fixed values. -> kept?
export function record(store, shape, {rung, outcome, kind, signal, verified} = {}, {now = Date.now()} = {}) {
  if (verified !== true || !SHAPE.test(String(shape))) return false;
  const entry = cleanEntry({by: rung, outcome, kind, signal, hits: store.data.kept[shape]?.hits, at: new Date(now).toISOString()});
  if (!entry) return false;
  store.data.kept[shape] = entry;
  const tally = store.data.tally[shape];
  store.data.tally[shape] = {rung: entry.by, kind: entry.kind, outcome: entry.outcome, hits: tally?.hits || 0, misses: tally?.misses || 0};
  trim(store);
  store.save();
  return true;
}
const trim = store => { const shapes = Object.keys(store.data.tally); if (shapes.length > MAX_SHAPES) for (const old of shapes.filter(name => !store.data.kept[name]).slice(0, shapes.length - MAX_SHAPES)) delete store.data.tally[old]; };

// Count a VERIFIED decision of the fast tier (rung 0, 1 or 2: the page moved on as decided, the form came, the fill put values in) for the shape. Never kept: the decision stays rung 1's,
// and a shape with a kept answer of a higher rung is confirmed by hit() instead. The same decision again adds a hit; another one starts again from one hit, its misses stay. -> counted?
export function confirm(store, shape, {rung, outcome, kind, verified} = {}) {
  if (verified !== true || !SHAPE.test(String(shape)) || !Number.isInteger(rung) || rung < 0 || rung >= MIN_RUNG || !OUTCOMES.includes(outcome) || !KINDS.includes(kind) || store.data.kept[shape]) return false;
  const was = store.data.tally[shape], same = was && was.rung === rung && was.kind === kind && was.outcome === outcome;
  store.data.tally[shape] = {rung, kind, outcome, hits: same ? count(was.hits) + 1 : 1, misses: was?.misses || 0};
  trim(store);
  store.save();
  return true;
}

// The kept answer for the shape, or null. An email outcome is flagged askAgain: it says this shape asks for addresses, it is not an answer to reuse.
export function lookup(store, shape) {
  const entry = store.data.kept[shape];
  if (!entry) return null;
  return {...entry, misses: store.data.tally[shape]?.misses || 0, ...(entry.outcome === 'email' ? {askAgain: true} : {})};
}

// The kept answer was right again.
export function hit(store, shape) {
  const entry = store.data.kept[shape];
  if (!entry) return false;
  entry.hits = count(entry.hits) + 1;
  if (store.data.tally[shape]) store.data.tally[shape].hits = count(store.data.tally[shape].hits) + 1;
  store.save();
  return true;
}

// The page contradicted it: one miss drops it (the existing contradiction rule), the miss stays in the counts. A fast-tier count (confirm) counts the miss too: nothing was dropped.
// The remnant of a dropped higher-rung answer does not: the page now contradicts whatever answered after it.
export function miss(store, shape) {
  if (!store.data.kept[shape]) {
    if (!(store.data.tally[shape]?.rung < MIN_RUNG)) return false;
    store.data.tally[shape].misses = count(store.data.tally[shape].misses) + 1;
    store.save();
    return false;
  }
  delete store.data.kept[shape];
  if (store.data.tally[shape]) store.data.tally[shape].misses = count(store.data.tally[shape].misses) + 1;
  store.save();
  return true;
}

export const counts = store => Object.entries(store.data.tally).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  .map(([shape, row]) => ({shape, rung: row.rung, kind: row.kind || '', outcome: row.outcome, hits: row.hits, misses: row.misses}));
