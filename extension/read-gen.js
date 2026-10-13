// Which read of a tab an async answer belongs to (one per consider() of fill-flow.js): "is this result still about the tab's current read?" asked in ONE place. A read begins when a page of the
// tab is considered; a newer read of the same tab makes every answer still on its way to the older one late (pool run 38325158956, HelloFresh: the digest asked for the first, empty read landed
// after the second read had judged the form, and a "no form" dead end was reported mid-fill). The fill's own end-state write keeps its token in the page (fill-flow.js writeState: it guards what
// the PAGE shows, this guards what the FLOW decides). Guard: worker/test/read-generation.test.js.
const gens = new Map();   // tabId -> the latest read's number

export const beginRead = tabId => { const gen = (gens.get(tabId) || 0) + 1; gens.set(tabId, gen); return gen; };
export const isCurrent = (tabId, gen) => gens.get(tabId) === gen;
export const forgetReads = tabId => { gens.delete(tabId); };
globalThis.chrome?.tabs?.onRemoved?.addListener(forgetReads);
