/* global document */
// A person's click on a page the extension is filling: wait for its overlay to lift, click, and click again if the overlay came back in between (c09c6a8 holds trusted clicks).
const GONE = () => !document.getElementById('jobpilotto-fill-overlay');

// `act` is one Playwright action on the tab (check or click); a click lost under a returning overlay throws or changes nothing, so it is tried again after the overlay lifts.
export async function whenFree(tab, act, {tries = 6, liftMs = 30000} = {}) {
  let last = null;
  for (let at = 0; at < tries; at += 1) {
    await tab.waitForFunction(GONE, null, {timeout: liftMs});
    try { return await act({timeout: 5000}); } catch (error) { last = error; }
  }
  throw last;
}

export const ticked = (tab, selector) => whenFree(tab, options => tab.check(selector, options));
export const pressed = (tab, selector) => whenFree(tab, options => tab.click(selector, options));
