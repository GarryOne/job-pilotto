// The person's Stop, the app's side (owner, 13 Oct 2026: "a way to stop"; extension/stop.js is the other): once the extension says it stopped, every live application form session says so,
// whatever step it was at, and the card offers Reopen form (the person's own Apply) to start it again. Pure over the terminals' own functions. Guard: desktop/test/stop-request.test.js.

// -> how many sessions changed (0 when all already said it).
export function stopLiveForms({list, noteStopped}) {
  let changed = 0;
  for (const session of list()) if (session.kind === 'form' && !session.outcome && noteStopped(session.id)) changed++;
  return changed;
}
