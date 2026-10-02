/* global document, getComputedStyle */
// The layout checks must catch the bug that started them: a job row whose location list ran to twenty lines (2 Oct 2026).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
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

test('a page that scrolls sideways is flagged and names the element that sticks out', async () => {
  const browser = await chromium.launch({channel: 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 800, height: 600}});
    const wide = await findings(page, `<section class="view" data-view="jobs"><div class="card" id="wide" style="width:1000px;height:40px">x</div></section>`);
    const overflow = wide.find(item => item.kind === 'page-overflow');
    assert.ok(overflow, `a 1000px element in an 800px window was not flagged: ${JSON.stringify(wide)}`);
    assert.match(overflow.detail, /sticking out: .*card.*right edge 1008px/);
    const fine = await findings(page, `<section class="view" data-view="jobs"><div class="card" style="width:600px;height:40px">x</div></section>`);
    assert.ok(!fine.some(item => item.kind === 'page-overflow'));
  } finally { await browser.close(); }
});

test('a long status in the activity bar never widens the window (2 Oct 2026: the Interviews page scrolled sideways, 1306px in 1280px)', async () => {
  const browser = await chromium.launch({channel: 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1280, height: 800}});
    // A file page, not setContent: the real stylesheets only load from a file: origin.
    const file = path.join(os.tmpdir(), `jp-activity-bar-${process.pid}.html`);
    fs.writeFileSync(file, `<link rel="stylesheet" href="file://${css}/tokens.css"><link rel="stylesheet" href="file://${css}/style.css">
      <section class="app"><nav class="sidebar"></nav><main><div class="view"></div></main>
        <footer class="activity"><button class="activity-bar"><span class="activity-dot"></span><b>Last jobs check had problems</b>
          <span class="activity-step">Fri 15:55 · nothing new · click to see why</span>
          <span class="activity-meta">Gmail checked Fri 16:31 · Gmail check: 13 new email(s) read, 6 update(s) recorded</span><span class="activity-open">Details ▴</span></button></footer></section>`);
    await page.goto(`file://${file}`);
    await page.waitForTimeout(200);
    const {scroll, client, columns} = await page.evaluate(() => ({scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth,
      columns: getComputedStyle(document.querySelector('.app')).gridTemplateColumns}));
    assert.notEqual(columns, 'none', 'the real stylesheet did not load into the test page');
    const out = await page.evaluate(() => [...document.querySelectorAll('*')].filter(el => el.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
      .map(el => `${el.tagName.toLowerCase()}.${el.className} → ${Math.round(el.getBoundingClientRect().right)}px`));
    assert.ok(scroll <= client, `the page is ${scroll}px wide in a ${client}px window (columns ${columns}); sticking out: ${out.join(', ')}`);
  } finally { await browser.close(); }
});
