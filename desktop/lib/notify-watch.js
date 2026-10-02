// macOS drops a notification from an app it hasn't allowed (the dev app from `npm start`, a fresh install) without
// a 'failed' event, so the message was lost silently (2 Oct 2026: the 11:00 focus reminder). A notification is only
// "delivered" once it says 'show'; if nothing came within `ms`, the caller shows the message in the window instead.
export function watch(note, {ms = 2000, onShown, onFailed, onMissing, timer = setTimeout, clear = clearTimeout}) {
  let done = false;
  const handle = timer(() => { if (!done) { done = true; onMissing(); } }, ms);
  note.on('show', () => { if (!done) { done = true; clear(handle); onShown(); } });
  note.on('failed', error => { if (!done) { done = true; clear(handle); onFailed(error); } });
}
