// Back and forward through the screens you opened (⌘← / ⌘→, ⌘[ / ⌘], the mouse's side buttons; Alt+← / Alt+→ on
// Windows). Pure state, no window needed (test/view-history.test.js); pages/nav.js records each screen and moves.
const MAX = 50;

export const start = name => ({list: name ? [name] : [], at: name ? 0 : -1});

// A screen opened by you (not by back/forward): later ones are dropped; the same screen again is no new step.
// Right after the Recent activity panel was closed, the next screen takes the place of that "closed" step: clicking
// Jobs with the panel open is one step back to the panel, not two. (Opening the panel again is a step of its own.)
export function visit(history, name) {
  if (!name || history.list[history.at] === name) return history;
  const keep = history.closed && !step(name).panel ? history.at : history.at + 1;
  const list = [...history.list.slice(0, keep), name].slice(-MAX);
  return {list, at: list.length - 1};
}

export function back(history) {
  return history.at > 0 ? {name: history.list[history.at - 1], history: {list: history.list, at: history.at - 1}} : {name: null, history};
}

export function forward(history) {
  return history.at < history.list.length - 1 ? {name: history.list[history.at + 1], history: {list: history.list, at: history.at + 1}}
    : {name: null, history};
}

// The Recent activity panel open over a screen is a step of its own, with the run it shows ('' = the running task):
// "focus#activity:42". step() reads either kind back.
export const panelStep = (view, run) => `${view}#activity:${run ?? ''}`;
export function step(name) {
  const match = /^(.*)#activity:(.*)$/.exec(name || '');
  if (!match) return {view: name || null, panel: false, run: null};
  return {view: match[1], panel: true, run: match[2] === '' ? null : /^\d+$/.test(match[2]) ? Number(match[2]) : match[2]};
}

// You opened the panel: a new step (or the same one again).
export const openPanel = (history, run) => visit(history, panelStep(step(history.list[history.at]).view, run));

// The panel's step remembers the run it shows now (you picked another row): coming back to it shows that one.
export function withRun(history, run) {
  const now = step(history.list[history.at]);
  if (!now.panel) return history;
  const list = [...history.list];
  list[history.at] = panelStep(now.view, run);
  return {...history, list};
}

// You closed the panel (Escape, ✕, a press outside it): its step keeps the run it showed last, and the screen under it
// becomes the next step, so ⌘← opens the panel again. Not a panel step (opened before any screen): unchanged.
export function closePanel(history, run) {
  const now = step(history.list[history.at]);
  if (!now.panel) return history;
  return {...visit(withRun(history, run), now.view), closed: true};
}

// 'back' / 'forward' for a key press, or null. ⌘←/⌘→ (Mac) and Alt+←/Alt+→ (Windows) only outside a text box, where
// they move the cursor; ⌘[ / ⌘] everywhere on a Mac.
export function navKey(event, {mac = true, editable = false} = {}) {
  if (event.shiftKey) return null;
  const mod = mac ? event.metaKey && !event.ctrlKey && !event.altKey : event.altKey && !event.ctrlKey && !event.metaKey;
  if (!mod) return null;
  if (mac && (event.key === '[' || event.key === ']')) return event.key === '[' ? 'back' : 'forward';
  if (editable) return null;
  return event.key === 'ArrowLeft' ? 'back' : event.key === 'ArrowRight' ? 'forward' : null;
}
