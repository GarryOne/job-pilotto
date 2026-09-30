// Back and forward through the screens you opened (⌘← / ⌘→, ⌘[ / ⌘], the mouse's side buttons; Alt+← / Alt+→ on
// Windows). Pure state, no window needed (test/view-history.test.js); pages/nav.js records each screen and moves.
const MAX = 50;

export const start = name => ({list: name ? [name] : [], at: name ? 0 : -1});

// A screen opened by you (not by back/forward): later ones are dropped; the same screen again is no new step.
export function visit(history, name) {
  if (!name || history.list[history.at] === name) return history;
  const list = [...history.list.slice(0, history.at + 1), name].slice(-MAX);
  return {list, at: list.length - 1};
}

export function back(history) {
  return history.at > 0 ? {name: history.list[history.at - 1], history: {...history, at: history.at - 1}} : {name: null, history};
}

export function forward(history) {
  return history.at < history.list.length - 1 ? {name: history.list[history.at + 1], history: {...history, at: history.at + 1}}
    : {name: null, history};
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
