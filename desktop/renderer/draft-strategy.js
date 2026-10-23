// The setup's drafted strategy as the Strategy page's cards read it (the shape of src/desktop_strategy.py strategy(): lists as {fragment, label}, texts,
// goals, relocation, remote_jobs, level, digest_min_score), so step 3 draws the same cards from the draft instead of the saved settings. Pure; guarded by
// test/draft-strategy.test.js.
import {fragmentWords} from './fragment-words.js';
import {searchLevel} from './goal-kinds.js';

const SEARCHED = 5;   // lib/target-roles.js: the first titles are also searched on job boards
const first = value => [value].flat().filter(Boolean)[0] || '';
const entries = items => (items || []).map(item => ({fragment: String(item), label: fragmentWords(item)})).filter(entry => entry.label);
const placeText = place => (place && typeof place === 'object' ? [place.location, place.language].filter(Boolean).join(' · ') : String(place ?? ''));
// The "Remote jobs" setting says no in any of these words (src/sources/feeds.py remote_wanted).
const NO = new Set(['no', 'non', 'nein', 'none', 'never', 'off', 'false']);

export function draftAsStrategy(draft = {}) {
  const search = draft.search || {}, preferences = draft.preferences || {}, places = search.locations || {};
  const roles = (search.target_roles || []).map(role => (typeof role === 'string' ? role : role?.title)).filter(Boolean);
  const goals = {...(draft.goals || {})};
  const level = String(first(search.level)).toLowerCase();
  return {
    ok: true,
    lists: {
      roles: roles.map((title, i) => ({fragment: title, label: title, searched: i < SEARCHED})),
      places: entries(places.top_tier), country: entries(places.country_wide), abroad: entries(places.abroad), searchOverride: entries(places.search_override),
      stack: entries(search.quality_stack_keywords), rights: entries(preferences.work_rights), remoteSkip: entries(search.remote_excluded_regions),
      titleSkip: entries(search.title_exclude_keywords), finders: entries(search.board_discovery_keywords),
    },
    texts: {
      languages: (preferences.disqualifying_languages || []).map(String), skip: (preferences.excluded_companies || []).map(String),
      gqueries: (search.google_jobs?.queries || []).map(String), gplaces: (search.google_jobs?.locations || []).map(placeText).filter(Boolean),
    },
    digest_min_score: preferences.digest_min_score,
    remote_jobs: ![search.remote_jobs].flat().some(value => NO.has(String(value ?? '').trim().toLowerCase())),
    relocation: first(places.relocation) || 'unspecified',
    goals, details: {}, level: level || (goals.seniority ? searchLevel(goals.seniority) : ''), compensation: goals.minimum_salary || '',
    avoid: [], components: [], scored: 0, stale: 0, previous: 0, counts: {matches: 0, kits: 0, sent: 0}, insight: null, profile_empty: false,
  };
}
