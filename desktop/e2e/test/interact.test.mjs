/* global window */
// The interaction probe: it clicks the safe controls of a page and says which ones did nothing, which expandables did not expand, which actions took long with no sign of
// work, and which clicks threw. Run on a fixture page with one of each (a real Chrome, no network).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright-core';
import {classify, isSafe, probePage} from '../lib/interact.mjs';

const PAGE = `<body><section class="view" data-view="fixture"><h1>Fixture</h1><div id="out"></div>
<button id="dead">Does nothing</button>
<button id="works" onclick="document.getElementById('out').textContent='done'">Works</button>
<button id="expDead" aria-expanded="false" aria-controls="p1">Expand (broken)</button><div id="p1" hidden>one</div>
<button id="expOk" aria-expanded="false" aria-controls="p2" onclick="const p=document.getElementById('p2'); p.hidden=!p.hidden; this.setAttribute('aria-expanded', String(!p.hidden))">Expand (works)</button><div id="p2" hidden>two</div>
<button id="slow" onclick="window.fake(900)">Slow without loading</button>
<button id="slowOk" onclick="this.disabled=true; window.fake(900).then(() => { this.disabled = false; })">Slow with loading</button>
<button id="boom" onclick="throw new Error('handler failed')">Throws</button>
<button id="del" onclick="window.clicked = true">Delete everything</button>
</section><script>
window.fakeIpc = []; window.clicked = false;
window.fake = ms => { const rec = {channel: 'work', start: Date.now(), ms: null}; window.fakeIpc.push(rec); return new Promise(done => setTimeout(() => { rec.ms = Date.now() - rec.start; done(); }, ms)); };
</script></body>`;

const ipcOf = page => ({mark: () => page.evaluate(() => window.fakeIpc.length), since: mark => page.evaluate(count => window.fakeIpc.slice(count), mark)});

test('the safe controls are the ones that cannot delete, send, quit or leave the app', () => {
  for (const text of ['Today', 'Settings', 'Show more', 'History']) assert.equal(isSafe({text}), true, text);
  for (const text of ['Delete everything', 'Remove job', 'Quit', 'Send to Telegram', 'Apply', 'Submit', 'Sign in with Google', 'Open in Notion ↗', 'Run', 'Record interview', 'Replace CV', 'Check for new jobs', 'Refresh', 'Rebuild from CV…']) assert.equal(isSafe({text}), false, text);
  assert.equal(isSafe({text: 'Details', cls: 'danger'}), false);
  assert.equal(isSafe({text: 'Link', href: 'https://example.com/x'}), false, 'an external link leaves the app');
});

test('classify names each kind of bug and says nothing for a working control', () => {
  const control = {label: 'button#b', text: 'Go', expandable: false};
  assert.equal(classify({view: 'v', control, effects: [], calls: [], errors: []})[0].kind, 'dead-control');
  assert.deepEqual(classify({view: 'v', control, effects: ['text changed'], calls: [], errors: []}), []);
  assert.deepEqual(classify({view: 'v', control, effects: [], calls: [{channel: 'x', ms: 20}], errors: []}), []);
  assert.equal(classify({view: 'v', control: {...control, expandable: true}, effects: ['text changed'], calls: [], errors: []})[0].kind, 'expand-broken', 'something changed but not the expandable');
  assert.equal(classify({view: 'v', control, effects: ['text changed'], calls: [{channel: 'x', ms: 900}], loading: false, errors: []})[0].kind, 'no-loading-state');
  assert.deepEqual(classify({view: 'v', control, effects: ['text changed'], calls: [{channel: 'x', ms: 900}], loading: true, errors: []}), []);
  assert.deepEqual(classify({view: 'v', control: {...control, expandable: true}, effects: ['control removed'], calls: [], errors: []}), [], 'the page drew itself again');
  assert.equal(classify({view: 'v', control, effects: ['x'], calls: [], errors: ['TypeError: nope']})[0].kind, 'console-error');
});

test('on a page with one of each, the probe flags exactly the broken controls and clicks nothing destructive', async () => {
  const browser = await chromium.launch({channel: 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1000, height: 700}});
    await page.setContent(PAGE);
    const {results, findings} = await probePage({page, view: 'fixture', ipc: ipcOf(page), settleMs: 1200});
    const by = kind => findings.filter(item => item.kind === kind).map(item => item.control);
    assert.deepEqual(by('dead-control'), ['Does nothing'], JSON.stringify(findings));
    assert.deepEqual(by('expand-broken'), ['Expand (broken)']);
    assert.deepEqual(by('no-loading-state'), ['Slow without loading']);
    assert.deepEqual(by('console-error'), ['Throws']);
    assert.equal(await page.evaluate(() => window.clicked), false, 'the destructive button was left alone');
    assert.ok(results.some(item => item.control === 'Works' && item.effects.length), 'a working control is recorded as working');
    assert.ok(results.every(item => item.control !== 'Delete everything'));
  } finally { await browser.close(); }
});
