// One job of the night (spec docs/superpowers/specs/2026-10-17-ready-to-send.md): open the posting in a tab of the night's browser, ask the real extension to fill it the way the app's "Apply" does (the address hash, then the panel's Fill
// button), and read what it reported to the stand-in. The tab stays open, filled, for the morning. Nothing here presses Submit or an account button: the extension copy holds the account press and no-submit.mjs refuses a submission.
// -> {state, filled, left, humanCheck, wall, ms}, never a field value. Guard: desktop/test/ready-fill.test.js (classify) and the fixture proof (hosted/ready-fill/proof.mjs).
const FILL_BUTTON = /^(fill anyway|fill this form|fill again)$/i;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Pure: the outcome word from what the extension reported. `outcome` is the stand-in's {filled, left, role} or null; `panel` says whether the extension's panel appeared and offered Fill.
export function classify({outcome, panel, role}) {
  if (outcome && (outcome.role || role) === 'account') return {state: 'wall', wall: 'account'};   // a sign-in or sign-up page: phase 1 makes no account
  if (!outcome) return panel ? {state: 'failed', wall: 'no-record'} : {state: role === 'account' ? 'wall' : 'no-form', wall: role === 'account' ? 'account' : ''};
  if (!outcome.filled) return {state: 'no-form', wall: ''};
  return {state: outcome.left === 0 ? 'prepared' : 'partial', wall: ''};
}

// A human check on the page, by structure (a widget iframe or a site key box): reported so the morning page says "a check waits for you". Never solved here.
export const humanCheckIn = page => page.evaluate(() => !!document.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], iframe[src*="challenges.cloudflare"], [data-sitekey], .g-recaptcha, .h-captcha, .cf-turnstile')).catch(() => false);

// The app's "Apply" marks the tab with the address hash; the extension may start the fill by itself, and the person's click on Fill is the other way. Never both: a second pass only repeats the first.
async function pressFill(page, standIn, address, seconds = 25) {
  await page.evaluate(() => { location.hash = 'jobpilotto-fill'; }).catch(() => {});
  for (let waited = 0; waited < 8 && !standIn.started(address); waited++) await wait(1000);
  if (standIn.started(address)) return true;   // it started on its own
  const ready = await page.waitForFunction(() => document.getElementById('jobpilotto-review-host')?.shadowRoot?.querySelector('button'), null, {timeout: seconds * 1000}).then(() => true, () => false);
  if (!ready) return false;
  await wait(3000);   // the panel settles its buttons
  return page.evaluate(pattern => {
    const buttons = [...(document.getElementById('jobpilotto-review-host')?.shadowRoot?.querySelectorAll('button') || [])].filter(button => !button.disabled);
    const pick = buttons.find(button => new RegExp(pattern, 'i').test((button.textContent || '').trim()));
    if (pick) pick.click();
    return !!pick;
  }, FILL_BUTTON.source).catch(() => false);
}

// context: the night's Playwright context; standIn: createStandIn(); job: {id, url}. -> the outcome plus the tab.
export async function fillJob({context, standIn, job, fillSeconds = 120}) {
  const started = Date.now(), page = await context.newPage();
  try { await page.goto(job.url, {waitUntil: 'domcontentloaded', timeout: 30000}); } catch { return {page, state: 'failed', wall: 'unreachable', filled: 0, left: 0, humanCheck: false, ms: Date.now() - started}; }
  const panel = await pressFill(page, standIn, job.url);
  for (let waited = 0; panel && waited < fillSeconds && !standIn.outcome(job.url); waited++) await wait(1000);
  await wait(3000);   // the record is written once, at the fill's end; the page settles and a later pass or update may follow
  const outcome = standIn.outcome(job.url), verdict = classify({outcome, panel, role: standIn.role(job.url)});
  return {page, ...verdict, filled: outcome?.filled || 0, left: outcome?.left || 0, humanCheck: await humanCheckIn(page), ms: Date.now() - started};
}
