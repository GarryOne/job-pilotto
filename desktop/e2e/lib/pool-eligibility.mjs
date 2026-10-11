// Pool runs measure FILLING, so the extension's eligibility stop is off in them (owner via the coordinator, 11 Oct 2026): the fake applicant cannot take most
// pool postings (Sydney, US on-site), and a stop hid how far the fill gets. smoke.mjs gives every row, on BOTH paths (plain node: live.mjs -> lib/live-row.mjs;
// Electron: the apply suite -> lib/apply-live.mjs), LIVE_ELIGIBILITY=off; each live runner sets the harness extension's chrome.storage.local
// checkEligibility=false before Apply and says so in the run's first lines. SMOKE_ELIGIBILITY=on keeps the stop.
// Guard: e2e/test/pool-eligibility.test.mjs.
/* global chrome */

export const ELIGIBILITY_ENV = 'LIVE_ELIGIBILITY';

// The env a pool row runs with: eligibility off unless SMOKE_ELIGIBILITY=on asks to keep the stop (to measure the stop itself).
export const poolEnv = (env = process.env) => ({...env, [ELIGIBILITY_ENV]: env.SMOKE_ELIGIBILITY === 'on' ? 'on' : 'off'});

export const eligibilityOff = (env = process.env) => env[ELIGIBILITY_ENV] === 'off';

export const POOL_LINE = 'eligibility check: OFF in this run (a pool run measures filling; SMOKE_ELIGIBILITY=on keeps the stop)';

// Sets the extension's own switch (extension/options.js "Check eligibility before filling") through its service worker, then reads it back:
// a switch that did not take fails the run before anything is pressed. -> true when it was turned off, false when the env leaves it on.
export async function applyPoolEligibility(worker, {env = process.env, say = () => {}} = {}) {
  if (!eligibilityOff(env)) { say('eligibility check: on (LIVE_ELIGIBILITY is not "off")'); return false; }
  await worker.evaluate(() => chrome.storage.local.set({checkEligibility: false}));
  const stored = await worker.evaluate(() => chrome.storage.local.get('checkEligibility'));
  if (stored?.checkEligibility !== false) throw new Error(`eligibility check: asked OFF, but the extension's storage says ${JSON.stringify(stored)}`);
  say(POOL_LINE);
  return true;
}
