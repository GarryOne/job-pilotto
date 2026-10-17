// The kind of each setup goal on the Strategy page and the setup review (owner, 17 Oct 2026, "Strategy Goals: 2a builds now, in place"): the target level as chips, the work
// mode as a multi-pick, the minimum salary with the salary kind; languages stay read-only (Your details holds them). A value a control can't read stays as written ("Saved as: …").
// One entry per goal of renderer/goal-tiles.js GOAL_TILES and lib/goals.js GOALS: a goal added there without one fails test/goal-kinds.test.js.
// The target level is several picks (owner, 18 Oct 2026: a saved "Senior or higher (Senior, Staff/Principal, Lead/Manager)" showed nothing picked) and the one
// home of the search's level (owner, 18 Oct 2026: "Goals only"): searchLevel turns the picks into Search settings' level (lib/goal-level.js). test/goal-level.test.js.
export const LEVELS = ['Junior', 'Mid', 'Senior', 'Staff / Principal', 'Lead'];
// The picks a saved value states, by the level names themselves ("Staff / Principal" is said as staff or principal), as whole words.
const words = level => level.split('/').map(word => word.trim().toLowerCase());
export const levelPicks = text => LEVELS.filter(level => words(level).some(word => new RegExp(`(^|[^\\p{L}])${word}($|[^\\p{L}])`, 'iu').test(String(text || ''))));
// The search's level (src/levels.py): senior and lead skip only entry-level titles, mid skips entry and senior ones, junior skips senior ones. The one that
// skips no picked level, '' (any) when none fits.
export function searchLevel(text) {
  const picks = levelPicks(text), has = (...names) => names.some(name => picks.includes(name));
  if (!picks.length || (has('Junior') && has('Senior', 'Staff / Principal', 'Lead'))) return '';
  if (has('Junior')) return 'junior';
  if (has('Senior')) return 'senior';
  if (has('Staff / Principal', 'Lead')) return 'lead';
  return 'mid';
}
export const WORK_MODES = ['On-site', 'Hybrid', 'Remote'];
export const GOAL_KINDS = {
  seniority: {kind: 'multi', options: LEVELS, chips: true, read: text => levelPicks(text).join(', ')},
  work_mode: {kind: 'multi', options: WORK_MODES},
  minimum_salary: {kind: 'salary'},
  languages: {readOnly: true},
};
