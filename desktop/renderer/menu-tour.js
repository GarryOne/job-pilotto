// The first-launch menu tour: which stops, in which order, and whether it was seen. Never shown again once done or skipped. Guarded by test/menu-reveal.test.js.
export const STOPS = [
  {id: 'focus', target: '.nav[data-view="focus"]', title: 'Focus', text: 'What needs you today, most important first.'},
  {id: 'jobs', target: '.nav[data-view="jobs"]', title: 'Jobs', text: 'Your matches. Find jobs starts here.'},
  {id: 'applying', target: '.nav[data-view="sessions"]', title: 'Applying', text: 'The forms the extension fills in for you. You press Submit.'},
  {id: 'actions', target: '.nav[data-view="actions"]', title: 'Actions', text: 'Run a search, check Gmail, tailor CVs.'},
  {id: 'more', target: '#nav-more-head', title: 'More', text: 'Pages that unlock as you go. Open it to see when.'},
];
export const STEP_MS = 3000;   // five stops, about 15 seconds
// Only the stops whose target is on screen now (More is gone once everything is unlocked; the icon rail has no More).
export const stopsFor = present => STOPS.filter(stop => present(stop.target));
const KEY = 'jp.menu.tour';
export const seen = storage => { try { return storage.getItem(KEY) === 'done'; } catch { return true; } };   // storage blocked: do not nag
export const markSeen = storage => { try { storage.setItem(KEY, 'done'); } catch { /* ignore */ } };
