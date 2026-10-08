// Strategy, rebuild from the CV: what a new draft changes, grouped by what each change triggers (and its cost). Re-exported by strategy.js.
// Guarded by desktop/test/strategy-rebuild.test.js.
// ---------- Rebuild from CV: what a new draft changes, grouped by what each change triggers ----------
// Search criteria and filters change what the crawl keeps and hides; the Profile's scoring part changes every fit
// score (re-scored over the next searches, AI cost); standard answers only change future kits and forms. Locations
// and remote rules live in both the search settings (crawl) and the Profile (score): a change to them links the two
// groups, so they're applied together and can't disagree.
export const SCORE_USD = 0.015;       // one Sonnet 5 fit score, measured on the owner's runs (about 1.2 to 1.8 cents)
export const SCORES_PER_SEARCH = 60;  // the app's --score-max
const FORM_ONLY = /contact|\blinks?\b|application form answers|📎/i;
export const wordsOf = fragment => String(fragment).replace(/\\b/g, '').replace(/\([^()]*\)\?/g, '').replace(/\(([^()|]*)\|[^()]*\)/g, '$1').replace(/\[[^\]]*?([^\]])\]/g, '$1').replace(/[.?*+()^$|\\]/g, '').trim();
function sections(markdown, skipFormOnly = false) {
  const found = new Map();
  let name = '', skipping = false;
  for (const line of String(markdown || '').split('\n')) {
    const heading = line.match(/^\s*#+\s+(.*)/);
    if (heading) { name = heading[1].trim(); skipping = skipFormOnly && FORM_ONLY.test(name); if (!skipping) found.set(name, []); continue; }
    if (!skipping && line.trim()) (found.get(name) || found.set(name, []).get(name)).push(line.trim());
  }
  return found;
}
function sectionChanges(before, after, skipFormOnly) {
  const old = sections(before, skipFormOnly), next = sections(after, skipFormOnly);
  const changes = [];
  for (const [name, lines] of next) {
    if (!old.has(name)) changes.push(`+ ${name || 'Intro'} (new section)`);
    else if (old.get(name).join('\n') !== lines.join('\n')) changes.push(`~ ${name || 'Intro'}`);
  }
  for (const name of old.keys()) if (!next.has(name)) changes.push(`− ${name || 'Intro'} (removed)`);
  return changes;
}
function listChanges(label, before = [], after = []) {
  const old = new Set(before.map(wordsOf)), next = new Set(after.map(wordsOf));
  const added = [...next].filter(item => item && !old.has(item)), removed = [...old].filter(item => item && !next.has(item));
  return added.length || removed.length ? [`${label}: ${[...added.map(item => `+${item}`), ...removed.map(item => `−${item}`)].join(', ')}`] : [];
}
export function rebuildGroups({search = {}, preferences = {}, profile = '', answers = ''}, draft, {scored = 0, kits = 0} = {}) {
  const next = draft.search || {}, places = search.locations || {}, nextPlaces = next.locations || {};
  const where = [...listChanges('Top cities', places.top_tier, nextPlaces.top_tier), ...listChanges('Country', places.country_wide, nextPlaces.country_wide),
    ...listChanges('Abroad', places.abroad, nextPlaces.abroad), ...listChanges('Remote excluded for', search.remote_excluded_regions, next.remote_excluded_regions)];
  const searchChanges = [...listChanges('Roles', search.role_keywords, next.role_keywords), ...listChanges('Level', search.level, next.level),
    ...listChanges('Job board searches', search.jobs_board_search_queries, next.jobs_board_search_queries), ...where,
    ...listChanges('Excluded titles', search.title_exclude_keywords, next.title_exclude_keywords),
    ...listChanges('Key skills and tools', search.quality_stack_keywords, next.quality_stack_keywords)];
  const prefs = draft.preferences || {};
  const filterChanges = [...listChanges('Languages you don\'t work in', preferences.disqualifying_languages, prefs.disqualifying_languages),
    ...listChanges('Excluded companies', preferences.excluded_companies, prefs.excluded_companies),
    ...listChanges('Work without a visa in', preferences.work_rights, prefs.work_rights)];
  const profileChanges = sectionChanges(profile, draft.profile_markdown, true);
  const answerChanges = sectionChanges(answers, draft.answers_markdown, false);
  const searches = Math.max(1, Math.ceil(scored / SCORES_PER_SEARCH));
  const linked = where.length > 0 && profileChanges.length > 0;
  return [
    {id: 'search', title: 'Search criteria', changes: searchChanges, linked: linked ? 'profile' : null,
      impact: 'The next search crawls and ranks with them. Jobs found before stay until they are unseen for 7 days.', cost: 'No AI cost'},
    {id: 'filters', title: 'Filters', changes: filterChanges, impact: 'Matching jobs are hidden at once.', cost: 'No AI cost'},
    {id: 'profile', title: 'Profile (what the fit score reads)', changes: profileChanges, linked: linked ? 'search' : null,
      impact: `Re-scores ${scored} job${scored === 1 ? '' : 's'} over the next ${searches} search${searches === 1 ? '' : 'es'}` +
        (kits ? `; ${kits} unsent kit${kits === 1 ? '' : 's'} were drafted with the old Profile (redraft the ones you still want)` : '') + '.',
      cost: scored ? 'Uses AI' : 'No AI cost'},
    {id: 'answers', title: 'Standard answers', changes: answerChanges, impact: 'Used by the next kits and form fills. Nothing is re-scored.', cost: 'No AI cost'},
  ].filter(group => group.changes.length);
}
