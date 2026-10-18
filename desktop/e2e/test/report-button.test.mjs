/* global document, location, window */
// The panel's Report button on a fixture form with the REAL extension: pressing it opens the report card, and a press that cannot is never silent (positive control: the button is found and pressed).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {startRealExtension} from '../lib/real-extension.mjs';

const FORM = `<!doctype html><title>Senior Site Reliability Engineer</title><form><h1>Apply</h1>
<label>Full name <input name="n" required></label><label>Email <input name="e" type="email" required></label><label>Phone <input name="p" required></label><label>City <input name="c" required></label></form>`;
const hostWords = () => {
  const panel = document.getElementById('jobpilotto-review-host')?.shadowRoot;
  return {panel: !!panel, reportBtn: !!panel?.querySelector('.report-btn'), cardHidden: panel?.querySelector('.card')?.hidden};
};

test('pressing the panel\'s Report opens the report card', async () => {
  const app = await startRealExtension({extensionDir: process.env.REAL_EXTENSION_DIR || undefined, allowAllSites: true, answer: {'/extension/report-form': () => ({ok: true, enabled: true})}});
  try {
    await app.context.route('https://jobs.example.test/**', route => route.fulfill({status: 200, contentType: 'text/html', body: FORM}));
    await app.page.goto('https://jobs.example.test/apply');
    await app.page.evaluate(() => { location.hash = 'jobpilotto-fill'; });
    await app.page.waitForFunction(() => document.getElementById('jobpilotto-review-host')?.shadowRoot?.querySelector('.report-btn'), null, {timeout: 20000});
    await app.page.waitForTimeout(2500);
    // The panel's card opens first (its pill/card), as the person sees it.
    await app.page.evaluate(() => { const root = document.getElementById('jobpilotto-review-host').shadowRoot; if (root.querySelector('.card').hidden) root.querySelector('.pill').click(); });
    assert.equal((await app.page.evaluate(hostWords)).reportBtn, true, 'positive control: the panel has its Report button');
    const box = await app.page.evaluate(() => { const b = document.getElementById('jobpilotto-review-host').shadowRoot.querySelector('.report-btn').getBoundingClientRect(); return {x: b.x + b.width / 2, y: b.y + b.height / 2}; });
    // The report card is in a closed shadow root: its host answers a hit-test where the card was drawn (beside the panel's pill, bottom right).
    const reportHostAt = () => app.page.evaluate(() => { const {innerWidth: w, innerHeight: h} = window; return document.elementFromPoint(w - 18 - 160, h - 84 - 50)?.id; });
    assert.notEqual(await reportHostAt(), 'jobpilotto-report-host', 'control: nothing there before the press');
    await app.page.mouse.click(box.x, box.y);
    await app.page.waitForFunction(() => document.elementFromPoint(window.innerWidth - 178, window.innerHeight - 134)?.id === 'jobpilotto-report-host', null, {timeout: 5000})
      .catch(() => assert.fail('the Report press opened no card beside the panel'));
    assert.equal(await app.page.evaluate(() => document.getElementById('jobpilotto-review-host').shadowRoot.querySelector('.card').hidden), true, 'the panel folds so the report card is the one thing there');
    await app.page.screenshot({path: process.env.SHOT || '/private/tmp/claude-502/-Users-mac-job-pilotto/f861c0c0-2ced-486d-82b2-1af7910620f1/scratchpad/report-button/after.png'});
  } finally { await app.close(); }
});
