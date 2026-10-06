// What to do after a jobs check that found few new jobs (owner, 6 Oct 2026: "buttons after the search is done"): the coverage answer's cards
// (renderer/coverage-card.js) as one list of actions, least effort first: a filter of yours to remove, a role word to add, a place to add (one
// click each), then a job source to connect (a key). Pure: the same actions the Strategy cards offer, so both say and do the same.
import {coverageCard, filtersCard, placesCard, sourcesCard} from './coverage-card.js';

export function coverageActions(verdict) {
  const out = [];
  for (const chip of filtersCard(verdict)?.chips || []) out.push({kind: chip.exclude ? 'exclude' : 'language', label: chip.label, title: chip.title, value: chip.exclude || chip.language});
  for (const chip of coverageCard(verdict)?.chips || []) out.push({kind: 'role', label: chip.label, title: chip.title, value: chip.term});
  for (const chip of placesCard(verdict)?.chips || []) out.push({kind: 'place', label: chip.label, title: chip.title, value: chip.place});
  for (const chip of sourcesCard(verdict)?.chips || []) out.push({kind: 'source', label: chip.label, title: chip.title, value: chip.id});
  return out;
}

// Advice shown and taken (owner, 7 Oct 2026: "what we recommended and whether the user took it"), as a technical report: the kind of advice,
// where it was shown, and for a job source its fixed id. Never the role word, place or filter itself. Shown once per kind and place a session.
const shownOnce = new Set();
// One name per kind of advice, wherever it is shown: a Strategy card's box or an action's kind.
const KIND = {coverage: 'role', role: 'role', places: 'place', place: 'place', filters: 'filter', exclude: 'filter', language: 'filter', sources: 'source', source: 'source', explain: 'explain', employer: 'employer'};
export function adviceEvent(act, kind, where, {source = '', record = globalThis.window?.pilot?.telemetryRecord} = {}) {
  kind = KIND[kind];
  if (!record || !kind || !['shown', 'taken', 'dismissed'].includes(act)) return false;
  if (act === 'shown') {
    if (shownOnce.has(`${where}:${kind}`)) return false;
    shownOnce.add(`${where}:${kind}`);
  }
  try { record('advice', {act, advice: String(kind), where: String(where), ...(kind === 'source' && /^[a-z_]{2,30}$/.test(source) ? {source} : {})}); } catch { return false; }
  return true;
}

// One action, done: the same calls the Strategy cards make (lib/strategy.js through main.js), or the source's panel in Settings.
export function runAction(action, {pilot, openSetting}) {
  if (action.kind === 'source') { openSetting(action.value); return Promise.resolve({ok: true, opened: true}); }
  if (action.kind === 'role') return pilot.addRoles([action.value]);
  if (action.kind === 'place') return pilot.addPlaces([action.value]);
  return pilot.loosenSearch(action.kind === 'exclude' ? {excludes: [action.value]} : {languages: [action.value]});
}
