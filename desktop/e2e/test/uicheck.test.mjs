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

// 2 Oct 2026 (issue #36): in the icon rail (window under 1180 px) every nav label is set to font-size 0 on purpose; the check reported "text is under 10px: Focus" on every page.
test('text that is hidden on purpose with font-size 0 is not tiny; real tiny text still is', async () => {
  const browser = await chromium.launch({channel: 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1280, height: 800}});
    const page_ = markup => findings(page, `<section class="view" data-view="jobs">${markup}</section>`);
    const hidden = await page_('<button class="nav" style="font-size:0;width:48px;padding:10px 0"><svg width="20" height="20"></svg>Focus</button>')   // the icon gives the button its size, the label is a bare text node;
    assert.deepEqual(hidden.filter(item => item.kind === 'tiny-text'), [], JSON.stringify(hidden));
    const tiny = await page_('<p style="font-size:8px">Tiny but shown</p>');
    assert.ok(tiny.some(item => item.kind === 'tiny-text'), `real tiny text was not flagged: ${JSON.stringify(tiny)}`);
  } finally { await browser.close(); }
});

// 2 Oct 2026 (issue #47's screenshot): in the icon rail the brand text ("Job Pilotto" + DEV) ran out of its 72 px box over the page title, and the "Search & commands" button was cut.
// No check saw it: the checks looked only inside the page (the sidebar is outside it), and "text cut off" only covered clipped text, not text that spills out and stays visible.
test('text that runs out of its box and stays visible is found, in the app chrome too, and an element that fits is not', async () => {
  const browser = await chromium.launch({channel: 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1024, height: 700}});
    const run = markup => findings(page, `<aside class="sidebar" style="width:72px"><div class="brand" style="white-space:nowrap">${markup}</div></aside><section class="view" data-view="jobs"><h1>Jobs</h1></section>`);
    const spilled = await run('Job Pilotto <span class="dev-tag">DEV</span>');
    const hit = spilled.find(item => item.kind === 'spill');
    assert.ok(hit, `the spilling brand was not flagged: ${JSON.stringify(spilled)}`);
    assert.equal(hit.chrome, true, 'something in the sidebar belongs to the app, not to the page');
    assert.match(hit.detail, /sidebar|brand/);
    const fine = await run('JP');
    assert.deepEqual(fine.filter(item => item.kind === 'spill'), []);
    const inPage = await findings(page, '<section class="view" data-view="jobs"><div class="card" style="width:60px"><span style="white-space:nowrap">a long label that does not fit</span></div></section>');
    const own = inPage.find(item => item.kind === 'spill');
    assert.ok(own && !own.chrome, `a spill inside the page: ${JSON.stringify(inPage)}`);
  } finally { await browser.close(); }
});

// #94: "400 {"type":"error",…,"request_id":…}" was shown in the CV card and filed only as a CSS spill. Technical text shown to a person is severe, whatever its size;
// technical text shown on purpose (a log block, a code sample, a terminal, a technical-log toggle) and an ordinary sentence about an error are not.
test('technical text shown to a person is a severe error-shown finding; logs, code and plain sentences are not', async () => {
  const browser = await chromium.launch({channel: 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1280, height: 800}});
    const raw = '400 {"type":"error","error":{"type":"invalid_request_error","message":"You have reached your specified API usage limits."},"request_id":"req_011"}';
    const shown = await findings(page, `<section class="view" data-view="jobs"><p id="cv-message" class="message">${raw}</p></section>`);
    const hits = shown.filter(item => item.kind === 'error-shown');
    assert.equal(hits.length, 1, JSON.stringify(shown));
    assert.equal(hits[0].severity, 'severe');
    assert.match(hits[0].detail, /p#cv-message\.message shows technical text to the person: "400 \{"type":"error"/);
    for (const markup of [`<pre>${raw}</pre>`, `<code>TypeError: x is undefined</code>`, `<details open><summary>Technical log</summary><div>${raw}</div></details>`, `<textarea>${raw}</textarea>`,
      `<p>Couldn't read your CV: the Anthropic API spending limit was reached (back on 2026-11-01).</p>`, `<p>The AI service had an error; try again in a minute.</p>`]) {
      const quiet = await findings(page, `<section class="view" data-view="jobs">${markup}</section>`);
      assert.deepEqual(quiet.filter(item => item.kind === 'error-shown'), [], markup);
    }
    const stack = await findings(page, `<section class="view" data-view="jobs"><div class="toast">Error: boom\n    at render (file:///app/renderer/pages/jobs.js:12:5)</div></section>`);
    assert.equal(stack.filter(item => item.kind === 'error-shown').length, 1, 'a stack trace is caught');
  } finally { await browser.close(); }
});

// #97: the tip ticker (style.css .ss-tip-text, a 20 s scroll) was caught mid-scroll and reported as clipped text. The AI review is now told what moves and what is cut on purpose.
test('what is moving and what is clipped on purpose are facts for the AI review', async () => {
  const {motionFacts} = await import('../lib/uicheck.mjs');
  const browser = await chromium.launch({channel: 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1280, height: 800}, reducedMotion: 'no-preference'});   // the app stops the ticker for reduced motion (style.css)
    const sheet = name => fs.readFileSync(path.join(css, name), 'utf8');   // inlined: a file:// sheet under setContent does not reliably apply
    await page.setContent(`<style>${sheet('tokens.css')}</style><style>${sheet('style.css')}</style>
      <div class="ss-tips" style="width:400px"><span class="ss-tip-chip">Worth trying</span><div class="ss-tip-frame"><span class="ss-tip-text">The employer's own career page is usually the freshest source of openings for you</span></div></div>
      <p style="width:120px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">A long headline that is cut on purpose</p>
      <p style="width:120px;white-space:nowrap;overflow:hidden">A long line cut by accident</p>`);
    await page.waitForTimeout(300);
    const facts = await page.evaluate(motionFacts);
    assert.ok(facts.moving.some(item => /ss-tip-text/.test(item)), JSON.stringify(facts));
    assert.ok(facts.clippedOnPurpose.some(item => /cut on purpose/.test(item)), JSON.stringify(facts));
    assert.ok(!facts.clippedOnPurpose.some(item => /by accident/.test(item)), 'a cut without an ellipsis, clamp or mask is not "on purpose"');
  } finally { await browser.close(); }
});

// 4 Oct 2026, the owner: "if I resize to the lowest vertically I cannot access the menu items at the bottom; there is no scroll". The column did scroll, but its scrollbar was hidden and
// the wheel does not scroll a drag area, so nothing showed it. The Finder never looked at the smallest height; now it does, and says what is wrong in plain words.
const menu = (css, buttons = 14) => `<style>body{margin:0}.sidebar{width:200px;height:100vh;display:flex;flex-direction:column;${css}}.sidebar button{height:40px;flex:none}</style>
  <nav class="sidebar">${Array.from({length: buttons}, (_, n) => `<button>Item ${n}</button>`).join('')}</nav>`;
const menuFindings = async (page, markup) => { await page.setContent(markup); await page.waitForTimeout(100); return (await page.evaluate(inspect, {view: 'jobs', limits: LIMITS})).filter(item => ['unreachable-control', 'hidden-scroll'].includes(item.kind)); };

test('a menu cut off by the window: nothing to scroll is unreachable, a scroll with no scrollbar is hidden, a visible scrollbar is fine', async () => {
  const browser = await chromium.launch({channel: 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1024, height: 400}});
    const stuck = await menuFindings(page, menu('overflow:hidden'));
    assert.deepEqual(stuck.map(item => item.kind), ['unreachable-control']);
    assert.match(stuck[0].detail, /cut off at this window size and nothing scrolls/);
    const quiet = await menuFindings(page, menu('overflow-y:auto;scrollbar-width:none'));
    assert.deepEqual(quiet.map(item => item.kind), ['hidden-scroll']);
    assert.match(quiet[0].detail, /scrolls with no visible scrollbar/);
    assert.deepEqual(await menuFindings(page, menu('overflow-y:auto;scrollbar-width:thin')), [], 'a visible scrollbar tells the person it scrolls');
    assert.deepEqual(await menuFindings(page, menu('overflow-y:auto', 3)), [], 'a menu that fits is fine');
  } finally { await browser.close(); }
});

test('the real menu at the smallest window height: the old hidden-scrollbar column is flagged, the current one is reachable', async () => {
  const browser = await chromium.launch({channel: 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1024, height: 640}});
    const open = async extra => {
      await page.goto(`file://${css}/index.html`);
      await page.waitForTimeout(300);
      await page.evaluate(styles => { for (let e = document.querySelector('.sidebar'); e; e = e.parentElement) e.hidden = false; const tag = document.createElement('style'); tag.textContent = styles; document.head.append(tag); }, extra);
      return (await page.evaluate(inspect, {view: 'jobs', limits: LIMITS})).filter(item => ['unreachable-control', 'hidden-scroll'].includes(item.kind));
    };
    const old = await open('.sidebar{overflow-y:auto !important;scrollbar-width:none !important}.sidebar .nav-scroll{display:contents !important}');
    assert.ok(old.some(item => item.kind === 'hidden-scroll'), `the owner's bug was not flagged: ${JSON.stringify(old)}`);
    assert.deepEqual(await open(''), [], 'the current menu keeps the bottom buttons in view and the list scrolls with a scrollbar');
  } finally { await browser.close(); }
});
