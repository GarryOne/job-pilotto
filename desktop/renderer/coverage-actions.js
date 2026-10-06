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

// One action, done: the same calls the Strategy cards make (lib/strategy.js through main.js), or the source's panel in Settings.
export function runAction(action, {pilot, openSetting}) {
  if (action.kind === 'source') { openSetting(action.value); return Promise.resolve({ok: true, opened: true}); }
  if (action.kind === 'role') return pilot.addRoles([action.value]);
  if (action.kind === 'place') return pilot.addPlaces([action.value]);
  return pilot.loosenSearch(action.kind === 'exclude' ? {excludes: [action.value]} : {languages: [action.value]});
}
