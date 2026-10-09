// What people do with a proposed answer on the session page ("Needs your attention"), counted so the product sees, per release and per
// source, whether its proposals get better from one iteration to the next (owner, 9 Oct 2026: "how are we improving from one iteration to
// another ... by leveraging data"). Fixed words only, never a value or a question's wording. The renderer says shown / used / edited
// (renderer/pages/need-proposal.js); the main process adds the board and the app's version (session-handlers.js) and the reporter batches
// them (lib/recipes.js proposalUse); the site keeps counts per day (site/src/knowledge.js, proposal_use) and the digest shows the share used.
// Guarded by test/proposal-use.test.js.
// Where the proposal came from (renderer/proposal-pick.js):
//   fill_guess  the form AI's most likely answer (worker use: "propose")   fill_tried  an answer the fill gave and the form did not take
//   details     your saved detail   cv  your CV   profile  your Profile (contact-from-cv.js)   empty  no proposal: a box to type in
export const SOURCES = ['fill_guess', 'fill_tried', 'details', 'cv', 'profile', 'empty'];
// shown: the row was drawn (once per session and field). used: Use with the proposal as it was. edited: Use after changing it (or typing into an empty box).
export const ACTS = ['shown', 'used', 'edited'];
const BOARD = /^(h:[0-9a-f]{10}|[a-z0-9.-]{2,40})$/;
const VERSION = /^[\w.+-]{1,20}$/;

// -> {board, source, act, v} or null when anything is not one of the fixed words.
export function cleanUse(item) {
  const board = String(item?.board || ''), source = String(item?.source || ''), act = String(item?.act || ''), v = String(item?.v || '');
  if (!BOARD.test(board) || !SOURCES.includes(source) || !ACTS.includes(act)) return null;
  return {board, source, act, v: VERSION.test(v) ? v : ''};
}
// Which act a Use was: the value sent against what was proposed.
export const actOf = (value, proposed) => (String(proposed || '').trim() && String(value || '').trim() === String(proposed).trim() ? 'used' : 'edited');
