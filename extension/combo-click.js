// One armed dropdown, clicked for real and waited for until the page has finished deciding (split from flow.js clickCombos, 11 Oct 2026).
// The page opens the menu, filters it and picks the answer after the click, which can take seconds (the menu's own wait, then the typing wait of a
// search field). A second click before it finished toggled the menu shut and the result was read before the page wrote it (Ocado, right to work:
// "no option matched" on one run, "menu did not open" on the next). Guarded by desktop/e2e/test/combo-click.test.mjs.
const PATIENCE = {first: 1500, loading: 5000, option: 4500, deciding: 9000};

// page(func, args): runs func in the page (MAIN world). click(x, y): a trusted click. spot: the armed menu's spot from __jobPilottoNextCombo.
// Returns {picked, last}: whether the armed count dropped, and what the page observed (__jobPilottoLastPick, read once the page is done).
export async function clickCombo({page, click, spot, skip = 0, sleep = ms => new Promise(r => setTimeout(r, ms))}) {
  let picked = false, last = null;
  for (let attempt = 1; attempt <= 2 && !picked; attempt++) {
    const before = await page(() => window.__jobPilottoArmedCount());
    const at = attempt === 1 ? spot : await page(n => window.__jobPilottoNextCombo(n), [skip]);
    if (!at) break;
    await click(at.x, at.y);
    const loading = () => page(() => !!document.querySelector('[class*=loading-indicator], [class*=loadingIndicator], [class*=menu-notice--loading], [class*=loadingMessage]'));
    let spotClicked = false;
    for (let waited = 0, limit = PATIENCE.first; waited < limit; waited += 100) {
      await sleep(100);
      if ((await page(() => window.__jobPilottoArmedCount())) < before) break;
      // The menu ignored a scripted click on its option: the page left the option's spot, clicked here for real once (page/fill-menus.js armCombo).
      const spotAt = spotClicked ? null : await page(() => window.__jobPilottoPickSpot || null);
      if (spotAt) { spotClicked = true; await click(spotAt.x, spotAt.y); limit = Math.max(limit, waited + PATIENCE.option); }
      if (limit < PATIENCE.loading && await loading()) limit = PATIENCE.loading;
      // The page is still deciding (page/fill-menus.js __jobPilottoPicking): its answer comes before any second click.
      if (limit < PATIENCE.deciding && await page(() => !!window.__jobPilottoPicking)) limit = PATIENCE.deciding;
    }
    picked = (await page(() => window.__jobPilottoArmedCount())) < before;
    if (picked) break;
    // What the page saw this time. A menu that opened and showed no choice for the answer is not helped by a second click: it shuts the open menu and
    // the second pick overwrites the true observation with "did not open" (the Ocado runs). Retry only when the page never opened it.
    last = await page(() => window.__jobPilottoLastPick || null);
    await click(5, 5).catch(() => {}); await sleep(100);  // close the menu
    if (last?.opened) break;
  }
  last = await page(() => { const pick = window.__jobPilottoLastPick || null; window.__jobPilottoLastPick = null; return pick; }) || last;
  return {picked, last};
}
