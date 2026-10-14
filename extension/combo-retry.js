// One later retry of a dropdown the fill gave up on, once the page answers quickly again (14 Oct 2026: on a loaded machine the AI pick alone took 30 s, the menu's whole budget; the field was left that live had filled).
// A menu is retried once per fill; one that is given up on twice stays given up on (flow.js givenUp), so a dead menu costs two waits at most, a normal page none.
// pass(): one clickCombosNow -> results. gaveUp(): the labels given up on so far. forget(labels): lets those menus be tried again. quiet(): resolves when the page answers fast (or after its own limit).
// Guarded by desktop/e2e/test/combo-retry.test.mjs.
export async function clickWithRetry({pass, gaveUp, forget, quiet, retried = new Set()}) {
  const before = new Set(gaveUp());
  const first = await pass();
  const fresh = gaveUp().filter(label => !before.has(label) && !retried.has(label));
  if (!fresh.length) return first;
  for (const label of fresh) retried.add(label);
  forget(fresh);
  await quiet();
  const second = await pass();
  const again = new Set(second.map(result => result.label));
  return [...first.filter(result => !again.has(result.label) || !fresh.includes(result.label)), ...second];   // the retry's result replaces the given-up one
}

// The page answers a trivial call fast twice in a row, or 8 s have passed: the load that starved the first wait has eased (combo-retry.js).
export async function pageQuiet(tabId) {
  for (const began = Date.now(); Date.now() - began < 8000;) {
    const t = Date.now();
    await chrome.scripting.executeScript({target: {tabId}, world: 'MAIN', func: () => 1}).catch(() => {});
    if (Date.now() - t < 150) { await new Promise(r => setTimeout(r, 300)); const u = Date.now(); await chrome.scripting.executeScript({target: {tabId}, world: 'MAIN', func: () => 1}).catch(() => {}); if (Date.now() - u < 150) return; }
    await new Promise(r => setTimeout(r, 500));
  }
}
