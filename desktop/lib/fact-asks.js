// The facts of Your details that this Mac's forms asked, as the FIXED ids of lib/missing-facts.js CATALOG (owner, 18 Oct 2026: "server counts" in the missing-facts order):
// reported once a day with the other counts (lib/recipes.js intel.facts), never a label, a value or a wording; the site counts installs per fact (site/src/fact-asks.js)
// and the alias pack brings back {fact, share}, kept in data/facts.json and read by missing-facts' order. Guarded by test/fact-asks.test.js.
import {CATALOG} from './missing-facts.js';
import {keyOf} from '../renderer/question-filter.js';

export const FILE = 'data/facts.json';
const plain = keyOf;

// The ids of the catalogue's facts a form asked on this Mac (a verdict that means the fact, asked at least once).
export function asked(storage) {
  const verdicts = Object.values(storage.settings().questionVerdicts || {});
  return CATALOG.filter(fact => verdicts.some(entry => entry?.reuse === 'details' && plain(entry.fact) === plain(fact.label) && (entry.asked || entry.blocked))).map(fact => fact.id);
}

// What is to be sent today: [] when nothing was asked or today's report is out.
export function pending(storage, now = new Date()) {
  return storage.settings().factAsksDay === now.toISOString().slice(0, 10) ? [] : asked(storage);
}
// The same, marking the day as sent: a day sends once.
export function due(storage, now = new Date()) {
  const ids = pending(storage, now);
  if (ids.length) storage.saveSettings({factAsksDay: now.toISOString().slice(0, 10)});
  return ids;
}

// The pack's list cleaned: only catalogue ids, a share in (0, 1].
export const clean = list => (Array.isArray(list) ? list : []).filter(item => CATALOG.some(fact => fact.id === item?.fact) && Number(item.share) > 0 && Number(item.share) <= 1)
  .map(item => ({fact: item.fact, share: Math.round(Number(item.share) * 100) / 100})).slice(0, CATALOG.length);

// {[id]: share} from the pack's last answer (nothing yet, or no real install: {}).
export function shares(storage) {
  try { return Object.fromEntries(clean(JSON.parse(storage.readText(FILE) || '{}').facts).map(item => [item.fact, item.share])); } catch { return {}; }
}
