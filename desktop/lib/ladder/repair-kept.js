// The fill ladder's kept repairs (spec docs/superpowers/specs/2026-10-12-fill-ladder.md, PR D; amendment 5 "same learning"): a repair that worked on a control is kept per the control's
// structural fingerprint (extension/account-fill.js `fp`: the skeleton of its field box, page/skeleton.js: no text, ids or values: the same widget on two sites has the same one), so the
// next miss on that widget is repaired without asking the model (rung 1, free); one miss drops it (the ladder's contradiction rule, learning.js). Only page-independent repairs are kept:
// retype, commit, trusted_click, toggle, wait, and choose_option with option 0 (the page finds the option from the fill's own answer); a numbered option or a layer's button belongs to
// one page and is asked again. Fixed values only (fp, widget, verb, counts): there is no field for text. File fill-repairs.json, a cache (deleting it only means asking again).
// counts() -> [{fp, verb, ok, failed}] for the feed (next-move's sendMoves `repairs`, fixed values and integers). Guard: test/repair-kept.test.js.
import fs from 'node:fs';
import {VERBS, WIDGETS} from './fill-repair.js';

export const FP = /^[a-z0-9]{6,16}$/;   // page/skeleton.js fingerprint (cyrb53, base 36); lib/recipes.js checks the same shape
export const KEEPABLE = ['retype', 'commit', 'trusted_click', 'toggle', 'wait', 'choose_option'];
const MAX = 500;
const count = value => (Number.isInteger(value) && value >= 0 ? Math.min(value, 1e6) : 0);
const cleanKept = raw => (KEEPABLE.includes(raw?.verb) && WIDGETS.includes(raw?.widget) ? {verb: raw.verb, widget: raw.widget, hits: count(raw.hits)} : null);
const cleanTally = raw => (VERBS.includes(raw?.verb) ? {verb: raw.verb, ok: count(raw.ok), failed: count(raw.failed)} : null);

export function repairStore(file) {
  const data = {kept: {}, tally: {}};
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const [fp, entry] of Object.entries(raw?.kept || {})) { const clean = FP.test(fp) && cleanKept(entry); if (clean) data.kept[fp] = clean; }
    for (const [fp, entry] of Object.entries(raw?.tally || {})) { const clean = FP.test(fp) && cleanTally(entry); if (clean) data.tally[fp] = clean; }
  } catch { /* none yet, or unreadable: asked again */ }
  return {data, save: () => { try { fs.writeFileSync(file, JSON.stringify(data)); } catch { /* read-only: asked again next time */ } }};
}

// The kept repair for this control's fingerprint, or null.
export const keptFor = (store, fp) => (FP.test(String(fp || '')) && store.data.kept[fp] ? {verb: store.data.kept[fp].verb, widget: store.data.kept[fp].widget} : null);

// What a repair did on a control (the extension's report after running it: extension/ladder/fill-climb.js): worked -> kept (when page-independent) or a hit; failed -> a kept repair is
// dropped (one miss). Counted either way for the feed. -> 'kept' | 'hit' | 'dropped' | 'counted' | '' (not a valid row)
export function noteRepair(store, {fp, verb, widget, option, ok} = {}) {
  if (!FP.test(String(fp || '')) || !VERBS.includes(verb) || typeof ok !== 'boolean') return '';
  const tally = store.data.tally[fp] && store.data.tally[fp].verb === verb ? store.data.tally[fp] : {verb, ok: 0, failed: 0};
  if (ok) tally.ok += 1; else tally.failed += 1;
  store.data.tally[fp] = tally;
  let said = 'counted';
  const was = store.data.kept[fp];
  if (!ok && was) { delete store.data.kept[fp]; said = 'dropped'; }
  else if (ok && was && was.verb === verb) { was.hits = count(was.hits) + 1; said = 'hit'; }
  else if (ok && KEEPABLE.includes(verb) && (verb !== 'choose_option' || option === 0) && WIDGETS.includes(widget)) { store.data.kept[fp] = {verb, widget, hits: 0}; said = 'kept'; }
  const fps = Object.keys(store.data.tally);
  if (fps.length > MAX) for (const old of fps.filter(one => !store.data.kept[one]).slice(0, fps.length - MAX)) delete store.data.tally[old];
  store.save();
  return said;
}

export const counts = store => Object.entries(store.data.tally).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([fp, entry]) => ({fp, verb: entry.verb, ok: entry.ok, failed: entry.failed}));
