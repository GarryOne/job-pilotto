// The kind of each setup goal on the Strategy page and the setup review (owner, 17 Oct 2026, "Strategy Goals: 2a builds now, in place"): the target level as chips, the work
// mode as a multi-pick, the minimum salary with the salary kind; languages stay read-only (Your details holds them). A value a control can't read stays as written ("Saved as: …").
// One entry per goal of renderer/goal-tiles.js GOAL_TILES and lib/goals.js GOALS: a goal added there without one fails test/goal-kinds.test.js.
export const LEVELS = ['Junior', 'Mid', 'Senior', 'Staff / Principal', 'Lead'];
export const WORK_MODES = ['On-site', 'Hybrid', 'Remote'];
export const GOAL_KINDS = {
  seniority: {kind: 'single', options: LEVELS, chips: true},
  work_mode: {kind: 'multi', options: WORK_MODES},
  minimum_salary: {kind: 'salary'},
  languages: {readOnly: true},
};
