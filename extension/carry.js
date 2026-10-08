// What this extension knows about its tabs lives in chrome.storage.session: which session each tab belongs to (`session:`),
// which tabs the app opened (`armed:`), the sites being read (`read:`), this browser run's id (`boot`). Chrome empties it on
// any reload of the extension, its own update included, though the tabs and their ids are still there. On 8 Oct 2026 an update
// landed seconds after a fill: the app took the new run id for a Chrome restart, lost which tab was the session's form and said
// "Form closed" while it was open, and the panel went back to "Fill this form". So before its own reload the extension writes
// it to local storage, and the new worker puts it back. Only for a moment: kept longer, it could come back after a Chrome
// restart, where tab ids start again and would point at other tabs.
export const CARRY_MS = 60 * 1000;
export const packCarry = (items, now = Date.now()) => ({at: now, items: items && typeof items === 'object' ? items : {}});
// The items to put back, or null: nothing was carried, or it is too old to trust.
export const unpackCarry = (carry, now = Date.now()) => (carry && typeof carry === 'object' && Number.isFinite(carry.at)
  && now - carry.at >= 0 && now - carry.at < CARRY_MS && carry.items && typeof carry.items === 'object' ? carry.items : null);
