// What to do after a jobs check that found few new jobs (owner, 6 Oct 2026: "buttons after the search is done"): the coverage answer's cards
// (renderer/coverage-card.js) as one list of actions, least effort first: a filter of yours to remove, a role word to add, a place to add (one
// click each), then a job source to connect (a key). Pure: the same actions the Strategy cards offer, so both say and do the same.
import {coverageCard, filtersCard, placesCard, sourcesCard, visitCard} from './coverage-card.js';

export function coverageActions(verdict) {
  const out = [];
  for (const chip of filtersCard(verdict)?.chips || []) out.push({kind: chip.exclude ? 'exclude' : 'language', label: chip.label, title: chip.title, value: chip.exclude || chip.language});
  for (const chip of coverageCard(verdict)?.chips || []) out.push({kind: 'role', label: chip.label, title: chip.title, value: chip.term});
  for (const chip of placesCard(verdict)?.chips || []) out.push({kind: 'place', label: chip.label, title: chip.title, value: chip.place});
  for (const chip of sourcesCard(verdict)?.chips || []) out.push({kind: 'source', label: chip.label, title: chip.title, value: chip.id});
  for (const chip of visitCard(verdict)?.chips || []) out.push({kind: 'visit', label: chip.label, title: chip.title, value: chip.url});
  return out;
}

// Advice shown and taken (owner, 7 Oct 2026: "what we recommended and whether the user took it"), as a technical report: the kind of advice,
// where it was shown, and for a job source its fixed id. Never the role word, place or filter itself. Shown once per kind and place a session.
const shownOnce = new Set();
// One name per kind of advice, wherever it is shown: a Strategy card's box or an action's kind.
const KIND = {coverage: 'role', role: 'role', places: 'place', place: 'place', filters: 'filter', exclude: 'filter', language: 'filter', sources: 'source', source: 'source', explain: 'explain', employer: 'employer', visit: 'visit'};
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

// The "Few new jobs" box in groups (owner's approved layout, 7 Oct 2026): the employers meter with the one recommended action, words to add
// as chips, job sources and sites as rows with their own button. Pure: the box draws exactly this.
export const QUIET_SHARE = 0.3;   // under this share of employers with a match, the employer list is running dry: Find new employers
// How long your employers last (src/sources/feeds.py runway): one with nothing for you REST_AFTER searches in a row rests REST_DAYS days.
// Owner, 7 Oct 2026: "how many turns until I exhaust all my employers and am forced to run Find new employers".
export function runwayWords(runway, read) {
  if (!runway || !read) return '';
  const total = Number(read) || 0, resting = Number(runway.resting) || 0;
  const day = until => new Date(until).toLocaleDateString('en-GB', {day: 'numeric', month: 'short'});
  if (resting && resting * 2 >= total) return `${resting} of ${total} employers resting until ${day(runway.until)}: Find new employers to keep searching`;
  const soon = runway.soon;
  if (!soon?.count) return resting ? `${resting} of ${total} employers resting until ${day(runway.until)}` : '';
  return `${soon.runs} more search${soon.runs === 1 ? '' : 'es'} with nothing new, then ${soon.count} of ${total} employers rest for ${runway.rest_days} days`
    + ` (nothing for you ${runway.rest_after} times in a row)`;
}
export function fewJobsGroups(verdict) {
  const actions = coverageActions(verdict);
  const e = verdict?.employers || {};
  let employers = null;
  if (Number.isFinite(e.read) && e.read > 0) {
    const matched = Number(e.matched) || 0, pending = Number(e.pending) || 0;
    const share = matched / e.read;
    const dry = share < QUIET_SHARE;
    employers = {read: e.read, matched, pending, fill: Math.max(2, Math.round(share * 100)), dry,
      advice: dry ? 'Most have nothing new for you' : 'They still bring jobs',
      runway: runwayWords(e.runway, e.read),
      // Ideas the Find new employers task has not tried yet: a job search never touches them (owner, 7 Oct 2026: "why didn't 410 go down?").
      next: pending > 0 ? `${pending} employer idea${pending === 1 ? '' : 's'} not tried yet · Find new employers tries up to ${Number(e.batch) || 40} a run (3 minutes)`
        : 'every idea tried: Find new employers looks for new names'};
  }
  const sources = (Array.isArray(verdict?.sources) ? verdict.sources : []).map(source => ({id: source.id, name: source.name, sub: source.people || source.effort, title: `${source.effort}: ${source.gain}`}));
  const visits = (Array.isArray(verdict?.visits) ? verdict.visits : []).map(site => ({url: site.url, name: site.name,
    sub: site.kind === 'portal' ? 'your search' : `${site.why}${site.last_read ? ` · read ${site.last_read.slice(0, 10)}` : ''}`, title: site.note || ''}));
  return {employers, words: actions.filter(action => !['source', 'visit'].includes(action.kind)), sources, visits};
}

// One action, done: the same calls the Strategy cards make (lib/strategy.js through main.js), or the source's panel in Settings.
export function runAction(action, {pilot, openSetting}) {
  if (action.kind === 'source') { openSetting(action.value); return Promise.resolve({ok: true, opened: true}); }
  if (action.kind === 'visit') return pilot.openVisit(action.value).then(result => ({...result, opened: !!result?.ok}));
  if (action.kind === 'role') return pilot.addRoles([action.value]);
  if (action.kind === 'place') return pilot.addPlaces([action.value]);
  return pilot.loosenSearch(action.kind === 'exclude' ? {excludes: [action.value]} : {languages: [action.value]});
}
