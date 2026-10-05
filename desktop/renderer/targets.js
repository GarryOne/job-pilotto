// Where a click on a notification (macOS / Windows) or an in-window pop-up leads (pure, no DOM: main.js checks a target, the window follows it). A target is plain data with fixed keys, checked here before
// it reaches the window, so what a notification carries can only ever open a page, a section, a run's result or a job's row, never run anything:
//   {view: 'jobs'}                      a page (the data-view names of index.html)
//   {view: 'settings', section: 'profile'}   a page's section
//   {run: 123}                          a finished task's result: Recent activity with that run selected
//   {activity: true}                    Recent activity, as it is
//   {view: 'jobs', job: 'abc123'}       a job's row on a page (its code, else its address), scrolled to and flashed
export const VIEWS = ['actions', 'calendar', 'focus', 'interviews', 'jobs', 'sessions', 'settings', 'strategy'];
export const SECTIONS = ['overview', 'profile', 'connections', 'automation', 'data', 'license', 'advanced', 'appearance'];

// -> a safe copy of the target, or null when it says nothing the window can open.
export function clean(target) {
  if (!target || typeof target !== 'object') return null;
  const out = {};
  if (VIEWS.includes(target.view)) out.view = target.view;
  if (out.view === 'settings' && SECTIONS.includes(target.section)) out.section = target.section;
  if (Number.isFinite(Number(target.run)) && target.run !== null && target.run !== '') out.run = Number(target.run);
  if (target.activity === true) out.activity = true;
  if (typeof target.job === 'string' && target.job.trim()) out.job = target.job.trim().slice(0, 300);
  return Object.keys(out).length ? out : null;
}

// -> the steps the window takes, in order (pure, so the order is tested): 'run:123', 'activity', 'view:jobs', 'section:profile', 'job:abc'.
export function plan(target) {
  const t = clean(target);
  if (!t) return [];
  return [...(t.run !== undefined ? [`run:${t.run}`] : t.activity ? ['activity'] : []), ...(t.view ? [`view:${t.view}`] : []),
    ...(t.section ? [`section:${t.section}`] : []), ...(t.job ? [`job:${t.job}`] : [])];
}
