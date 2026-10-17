// Which sidebar pages show yet: Interviews after the first application, Reports after the first weekly report; once shown they stay, with a dot until opened. Guarded by test/menu-reveal.test.js.
export const PROGRESSIVE = {
  interviews: signals => signals.applied,
  reports: signals => signals.weeklyReport,
};
// The page a nav button belongs to: Calendar is a tab inside Interviews, so its screen lights the Interviews button.
export const NAV_OF = {calendar: 'interviews'};
export const navOf = view => NAV_OF[view] || view;

// state: {revealed: [names], opened: [names]}. A page opened any way (⌘K too) is revealed.
export function nextState(state, signals, opened = null) {
  const revealed = new Set(state.revealed), seen = new Set(state.opened);
  for (const [name, rule] of Object.entries(PROGRESSIVE)) if (rule(signals)) revealed.add(name);
  const page = opened && navOf(opened);
  if (page && PROGRESSIVE[page]) { revealed.add(page); seen.add(page); }
  return {revealed: [...revealed], opened: [...seen]};
}
// What the menu draws for a progressive page: shown, and whether its dot is on.
export const looks = (state, name) => ({shown: state.revealed.includes(name), dot: state.revealed.includes(name) && !state.opened.includes(name)});

const KEY = 'jp.menu.reveal';
export function load(storage) {
  try { const saved = JSON.parse(storage.getItem(KEY) || '{}'); return {revealed: saved.revealed || [], opened: saved.opened || []}; } catch { return {revealed: [], opened: []}; }
}
export function save(storage, state) { try { storage.setItem(KEY, JSON.stringify(state)); } catch { /* private window: the menu just starts again */ } }
