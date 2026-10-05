/* global document */
// The recall benchmark: on a page like the app's, every planted bug is caught by the detector it was planted for, nothing planted is left behind,
// and the planted window errors are removed from the journey's record (never filed as real ones).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright-core';
import {journey, resetJourney} from '../lib/journey.mjs';
import {measureRecall, recallFindings, PLANTS} from '../lib/recall.mjs';

test('every planted bug is caught by its detector, and nothing planted stays', async () => {
  resetJourney();
  const browser = await chromium.launch({channel: 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1200, height: 800}});
    page.on('pageerror', error => journey.pageErrors.push(`${error.name}: ${error.message}`));
    page.on('console', message => { if (message.type() === 'error') journey.consoleErrors.push(message.text()); });
    page.on('requestfailed', request => journey.failedLoads.push(request.url()));
    // Like the app: the page itself never scrolls sideways, the content area does (overflow auto), and the page is long (a plant at the end would be off-screen).
    await page.setContent('<html lang="en"><head><title>t</title></head><body style="margin:0;overflow:hidden"><div class="app" style="height:100vh;position:relative"><nav class="sidebar" style="position:absolute;right:0;top:0;height:100%;width:120px;display:flex;flex-direction:column;overflow-y:auto"><div class="nav-scroll" style="display:flex;flex-direction:column">'+Array.from({length: 16}, (_, n) => `<button style="height:40px;flex:none">Item ${n}</button>`).join('')+'</div></nav><main style="height:100vh;overflow:auto;width:calc(100% - 140px)"><section class="view" data-view="focus" style="overflow-x:auto"><h1>Focus</h1><p>Up next</p>'+Array.from({length: 12}, (_, n) => `<p style="height:60px;margin:0 0 8px;background:#eee">Row ${n}</p>`).join('')+'<div style="height:3000px"></div></section></main></div></body></html>');
    const ipc = {mark: async () => 0, since: async () => []};
    const result = await measureRecall({page, view: 'focus', ipc});
    assert.equal(result.planted, PLANTS.length);
    assert.deepEqual(result.rows.filter(row => !row.caught).map(row => `${row.id} (${row.saw})`), []);
    assert.equal(await page.evaluate(() => !!document.getElementById('recall-plant')), false, 'the last plant was taken out');
    assert.deepEqual([...journey.pageErrors, ...journey.consoleErrors, ...journey.failedLoads], [], 'nothing the plants caused is left for filing (#116, #117: the broken-image plant leaked)');
    assert.deepEqual(recallFindings(result), []);
    assert.match(recallFindings({rows: [{id: 'tiny-text', detector: 'layout', caught: false, saw: ''}]})[0].detail, /^tiny-text was planted for the layout check and not caught/);
  } finally { await browser.close(); }
});
