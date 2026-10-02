// The layout checks must catch the bug that started them: a job row whose location list ran to twenty lines (2 Oct 2026).
import assert from 'node:assert/strict';
import path from 'node:path';
import {test} from 'node:test';
import {chromium} from 'playwright-core';
import {LIMITS, inspect} from '../lib/uicheck.mjs';
import {DESKTOP} from '../lib/app.mjs';

const css = path.join(DESKTOP, 'renderer');
const many = 'Remote - European Union; Spain; Italy; Germany; Switzerland; Denmark; Norway; Croatia; Ireland; Stockholm; Romania; Austria; Barcelona; Netherlands; Portugal; France; Berlin; Sweden; Hungary; Estonia';
const html = (place, extra = '') => `<link rel="stylesheet" href="file://${css}/tokens.css"><link rel="stylesheet" href="file://${css}/style.css"><style>${extra}</style>
  <section class="view" data-view="jobs"><div class="job-row" style="width:420px"><div class="place"><div class="place-line"><span>${place}</span></div></div></div></section>`;

async function findings(page, markup) {
  await page.setContent(markup);
  await page.waitForTimeout(200);
  return page.evaluate(inspect, {view: 'jobs', limits: LIMITS});
}

test('a row with twenty lines of places is flagged; the fixed one is not', async () => {
  const browser = await chromium.launch({channel: 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1280, height: 800}});
    const old = await findings(page, html(many, '.place-line span{display:block !important;-webkit-line-clamp:unset !important;overflow:visible !important;width:110px}'));
    assert.ok(old.some(item => item.kind === 'tall-row' && item.severity === 'severe'), `the old layout was not flagged: ${JSON.stringify(old)}`);
    const fixed = await findings(page, html('Remote - European Union; Spain +18', '.place-line span{width:110px}'));
    assert.deepEqual(fixed.filter(item => item.severity === 'severe'), []);
  } finally { await browser.close(); }
});
