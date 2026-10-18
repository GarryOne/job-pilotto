/* global document, location, window, chrome, innerWidth */
// While the extension fills, the page is dimmed and the person's clicks, keys and scrolling are held back; the panel comes forward; every way the fill ends takes the overlay away
// (real extension on a fixture form, fake data). The driver's own input passes through a gap flag; the overlay is invisible to hit-tests and reads (pointer-events: none).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {startRealExtension} from '../lib/real-extension.mjs';

const FORM = `<!doctype html><title>Senior Site Reliability Engineer</title><body style="height:3000px"><form><h1>Apply</h1>
<label>Full name <input id="n" name="n" required></label><label>Email <input id="e" name="e" type="email" required></label><label>Phone <input name="p" required></label><label>City <input name="c" required></label></form>
<script>window.hits = 0; addEventListener('click', () => { window.hits += 1; });</script>`;
const URL = 'https://jobs.example.test/apply';

const open = async (answer = {}) => {
  const app = await startRealExtension({extensionDir: process.env.REAL_EXTENSION_DIR || undefined, allowAllSites: true, answer});
  await app.context.route('https://jobs.example.test/**', route => route.fulfill({status: 200, contentType: 'text/html', body: FORM}));
  await app.page.goto(URL);
  await app.page.evaluate(() => { location.hash = 'jobpilotto-fill'; });
  await app.page.waitForFunction(() => document.getElementById('jobpilotto-review-host')?.shadowRoot?.querySelector('.report-btn'), null, {timeout: 20000});
  const worker = app.context.serviceWorkers()[0];
  const step = text => worker.evaluate(async words => { const [tab] = await chrome.tabs.query({url: 'https://jobs.example.test/*'}); return chrome.tabs.sendMessage(tab.id, {type: 'panelStep', text: words}); }, text);
  const overlay = () => app.page.evaluate(() => !!document.getElementById('jobpilotto-fill-overlay'));
  const host = () => app.page.evaluate(() => { const h = document.getElementById('jobpilotto-review-host'); const box = h?.getBoundingClientRect(); return {centred: !!h && /translate/.test(h.style.cssText), right: h?.style.right, x: box && Math.round(box.x + box.width / 2), w: innerWidth}; });
  const clickInput = async () => { await app.page.mouse.click(300, 60); return app.page.evaluate(() => ({hits: window.hits, focus: document.activeElement?.id || ''})); };
  return {app, step, overlay, host, clickInput, worker};
};

test('a fill step dims the page, holds the person\'s click, key and wheel, and centres the panel', async () => {
  const t = await open();
  try {
    await t.step('');   // the page's own fill mark may have started a first step (the overlay is rightly on then): end it, then the control
    await t.app.page.waitForFunction(() => !document.getElementById('jobpilotto-fill-overlay'), null, {timeout: 5000});
    assert.equal(await t.overlay(), false, 'control: no overlay before a fill');
    const before = await t.app.panel();
    await t.step('Filling Full name…');
    await t.app.page.waitForFunction(() => !!document.getElementById('jobpilotto-fill-overlay'), null, {timeout: 5000}).catch(() => assert.fail('no overlay while a fill step shows'));
    const hit = await t.app.page.evaluate(() => { const el = document.getElementById('n'); const b = el.getBoundingClientRect(); return document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.id; });
    assert.equal(hit, 'n', 'the overlay takes no hit-test: the page reads (elementFromPoint, on-top) see the form, not a layer');
    assert.deepEqual((await t.app.panel()).pill, before.pill, 'the form read is the same with the overlay on');
    const clicked = await t.app.page.evaluate(() => { const b = document.getElementById('n').getBoundingClientRect(); return {x: b.x + 10, y: b.y + 5}; });
    await t.app.page.mouse.click(clicked.x, clicked.y);
    assert.deepEqual(await t.app.page.evaluate(() => ({hits: window.hits, focus: document.activeElement?.id || ''})), {hits: 0, focus: ''}, 'the person\'s click never reaches the page');
    await t.app.page.keyboard.press('Tab');
    assert.equal(await t.app.page.evaluate(() => document.activeElement?.tagName), 'BODY', 'Tab moves nothing');
    await t.app.page.mouse.wheel(0, 800);
    await t.app.page.waitForTimeout(200);
    assert.equal(await t.app.page.evaluate(() => window.scrollY), 0, 'the page does not scroll');
    const spot = await t.host();
    assert.equal(spot.centred, true, 'the panel is centred while filling');
    const wide = await t.app.page.evaluate(() => document.getElementById('jobpilotto-review-host').shadowRoot.querySelector('.card').getBoundingClientRect().width);
    assert.ok(wide >= 460, `the panel is larger in the prime spot (${Math.round(wide)}px wide, the docked card is 372)`);
    // The driver's gap: the worker marks its own input, and it lands.
    await t.worker.evaluate(async () => { const [tab] = await chrome.tabs.query({url: 'https://jobs.example.test/*'}); await chrome.scripting.executeScript({target: {tabId: tab.id}, func: () => document.documentElement.setAttribute('data-jobpilotto-driving', '1')}); });
    await t.app.page.mouse.click(clicked.x, clicked.y);
    assert.equal(await t.app.page.evaluate(() => document.activeElement?.id), 'n', 'during the driver\'s own action the click lands');
  } finally { await t.app.close(); }
});

test('the end of the fill takes the overlay away and puts the panel back at its spot', async () => {
  const t = await open();
  try {
    await t.step('');   // the page's own fill mark may have started a step: end it, then the panel is at its spot
    await t.app.page.waitForFunction(() => !document.getElementById('jobpilotto-fill-overlay'), null, {timeout: 5000});
    const home = await t.host();
    await t.step('Filling Full name…');
    await t.app.page.waitForFunction(() => !!document.getElementById('jobpilotto-fill-overlay'), null, {timeout: 5000});
    await t.step('');
    await t.app.page.waitForFunction(() => !document.getElementById('jobpilotto-fill-overlay'), null, {timeout: 5000}).catch(() => assert.fail('the overlay stayed after the fill ended'));
    const back = await t.host();
    assert.deepEqual({centred: back.centred, right: back.right}, {centred: home.centred, right: home.right}, 'the panel is back where it was');
    const free = await t.clickInput();
    assert.ok(free.hits >= 1, 'the person\'s click reaches the page again');
  } finally { await t.app.close(); }
});

test('Stop (in the panel step row) takes the overlay away and is pressable above it', async () => {
  const t = await open();
  try {
    await t.step('Filling Full name…');
    await t.app.page.waitForFunction(() => !!document.getElementById('jobpilotto-fill-overlay'), null, {timeout: 5000});
    const stop = await t.app.page.evaluate(() => { const b = document.getElementById('jobpilotto-review-host').shadowRoot.querySelector('.stop-btn').getBoundingClientRect(); return {x: b.x + b.width / 2, y: b.y + b.height / 2}; });
    await t.app.page.mouse.click(stop.x, stop.y);   // the panel's own Stop, above the dim layer
    await t.app.page.waitForFunction(() => !document.getElementById('jobpilotto-fill-overlay'), null, {timeout: 8000}).catch(() => assert.fail('Stop did not take the overlay away'));
  } finally { await t.app.close(); }
});

test('a page that needs the person (a captcha left) takes the overlay away', async () => {
  const t = await open();
  try {
    await t.step('Filling Full name…');
    await t.app.page.waitForFunction(() => !!document.getElementById('jobpilotto-fill-overlay'), null, {timeout: 5000});
    await t.app.page.evaluate(() => document.documentElement.setAttribute('data-jobpilotto-needs', 'a captcha'));
    await t.app.page.waitForFunction(() => !document.getElementById('jobpilotto-fill-overlay'), null, {timeout: 15000}).catch(() => assert.fail('"needs you" kept the overlay on: the person could not do the captcha'));
    assert.ok((await t.clickInput()).hits >= 1, 'the person is free to click');
  } finally { await t.app.close(); }
});

test('a stuck page (the app says stuck) takes the overlay away', async () => {
  const t = await open({'/extension/review': () => ({matched: true, session: {id: 's1', status: 'input', live: false, kind: 'form', stuck: 'stuck'}})});
  try {
    await t.step('Filling Full name…');
    await t.app.page.waitForFunction(() => !document.getElementById('jobpilotto-fill-overlay'), null, {timeout: 15000}).catch(() => assert.fail('a stuck page kept the overlay on'));
    assert.ok((await t.clickInput()).hits >= 1, 'the person is free to click on a stuck page');
  } finally { await t.app.close(); }
});

test('a navigation leaves no overlay', async () => {
  const t = await open();
  try {
    await t.step('Filling Full name…');
    await t.app.page.waitForFunction(() => !!document.getElementById('jobpilotto-fill-overlay'), null, {timeout: 5000});
    await t.app.page.goto('https://jobs.example.test/next');
    assert.equal(await t.overlay(), false);
  } finally { await t.app.close(); }
});
