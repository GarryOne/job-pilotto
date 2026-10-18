// Which sidebar pages show yet: Interviews after the first application, Reports after the first weekly report, Employers after the first employer; once shown they stay, with a dot until opened. Guarded by test/menu-reveal.test.js.
export const PROGRESSIVE = {
  interviews: signals => signals.applied,
  calendar: signals => signals.applied,   // with Interviews (owner, 18 Oct 2026: always once there is an interview, else under More)
  reports: signals => signals.weeklyReport,
  employers: signals => signals.employers,
};
// What the "More" row lists for a page that is not shown yet (owner, 17 Oct 2026): its name, icon and when it unlocks.
export const LOCKED = {
  interviews: {label: 'Interviews', icon: 'mic', when: 'after your first application'},
  calendar: {label: 'Calendar', icon: 'calendar', when: 'with interviews'},
  reports: {label: 'Reports', icon: 'chart', when: 'after your first week'},
  employers: {label: 'Employers', icon: 'building', when: 'after your first employer search'},
};
// The still-hidden pages, in the menu's order; the row shows their count and disappears at 0.
export const stillLocked = state => Object.keys(LOCKED)
  .filter(name => !state.revealed.includes(name)).map(name => ({name, view: name, ...LOCKED[name]}));

// state: {revealed: [names], opened: [names]}. A page opened any way (⌘K too) is revealed.
export function nextState(state, signals, opened = null) {
  const revealed = new Set(state.revealed), seen = new Set(state.opened);
  for (const [name, rule] of Object.entries(PROGRESSIVE)) if (rule(signals)) revealed.add(name);
  const page = opened;
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
