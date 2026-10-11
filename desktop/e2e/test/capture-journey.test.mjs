// What a live run keeps of the pages it saw, for an offline replay (lib/capture-page.mjs, lib/capture-journey.mjs): the applied CSS (a CSS-shown dialog, a
// frame's size), each iframe's document as its own page at its own address, every page under its own address, the cross-origin sheets as a text/css HAR.
// Headless Chromium, network blocked (pages served by routes); skipped without Chromium.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {cssRecorder, snapshotInPage} from '../lib/capture-page.mjs';
import {journeyRecorder} from '../lib/capture-journey.mjs';

let chromium = null;
try { ({chromium} = await import('playwright-core')); if (!fs.existsSync(chromium.executablePath())) chromium = null; } catch { /* no playwright */ }
const skip = !chromium && 'no Chromium installed';

const SITE = {
  'https://jobs.example.test/o/role': '<!doctype html><html><head><link rel="stylesheet" href="/site.css?v=9"><link rel="stylesheet" href="https://cdn.example.net/theme.css?v=1"><style>.x{color:red}</style></head>'
    + '<body><h1>Role</h1><dialog class="start shown"><button>Apply manually</button></dialog><iframe src="https://boards.example.net/embed/job_app?for=x&token=secret" style="width:650px;height:150px"></iframe>'
    + '<script>document.styleSheets[2].insertRule(".added{margin:3px}");</script></body></html>',
  'https://jobs.example.test/site.css': 'dialog.start.shown{display:block;position:static}',
  'https://cdn.example.net/theme.css': 'h1{font-size:40px}',
  'https://boards.example.net/embed/job_app': '<!doctype html><html><body><form><label for="f">First name</label><input id="f" name="first" value="typed"></form></body></html>',
  'https://jobs.example.test/o/role/apply': '<!doctype html><html><body><form><input name="email"></form></body></html>',
};
const type = url => (url.endsWith('.css') ? 'text/css' : 'text/html');
async function open() {
  const browser = await chromium.launch({headless: true});
  const context = await browser.newContext();
  await context.route(() => true, route => {
    const url = route.request().url().split('?')[0];
    if (!SITE[url]) return route.abort();
    // the cross-origin sheet has no CORS header: its rules cannot be read from the page, only from the network
    return route.fulfill({contentType: type(url), body: SITE[url]});
  });
  return {browser, context};
}

test('the snapshot keeps the applied CSS, the frame (without its query) and a cross-origin sheet as a link', {skip}, async () => {
  const {browser, context} = await open();
  try {
    const page = await context.newPage();
    await page.goto('https://jobs.example.test/o/role?ref=mail');
    const html = await page.evaluate(snapshotInPage);
    assert.match(html, /dialog\.start\.shown\s*\{\s*display: block/, 'a same-origin sheet is inlined as the rules the page applied');
    assert.match(html, /\.added\s*\{\s*margin: 3px/, 'a rule a script inserted (no source text) is kept');
    assert.match(html, /<link[^>]*rel="stylesheet"[^>]*href="https:\/\/cdn\.example\.net\/theme\.css"/, 'a cross-origin sheet stays a link, its query cut');
    assert.ok(!/site\.css/.test(html), 'an inlined sheet does not stay as a dead link');
    assert.match(html, /<iframe[^>]*src="https:\/\/boards\.example\.net\/embed\/job_app"[^>]*width:\s*650px/, 'the frame and its size stay; its query (a token) does not');
    assert.ok(!/secret|<script/.test(html));
  } finally { await browser.close(); }
});

test('the cross-origin sheets are kept as a text/css HAR, addresses without query', {skip}, async () => {
  const {browser, context} = await open();
  try {
    const styles = cssRecorder(context);
    const page = await context.newPage();
    await page.goto('https://jobs.example.test/o/role');
    await page.waitForLoadState('load');
    const har = await styles.har();
    const entries = har.log.entries.map(entry => [entry.request.url, entry.response.content.mimeType, entry.response.content.text]);
    assert.deepEqual(entries.find(entry => entry[0].startsWith('https://cdn.')), ['https://cdn.example.net/theme.css', 'text/css', 'h1{font-size:40px}']);
    assert.ok(har.log.entries.every(entry => !entry.request.url.includes('?')));
  } finally { await browser.close(); }
});

test('the journey keeps every page and every frame once settled, each under its own address, values scrubbed', {skip}, async () => {
  const {browser, context} = await open();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-journey-'));
  try {
    const journey = journeyRecorder(context, {scrub: html => html.replace(/Role/g, 'Rôle')});
    const page = await context.newPage();
    await page.goto('https://jobs.example.test/o/role');
    for (let i = 0; i < 3; i++) await journey.tick();   // the run's watch loop calls tick() on every turn: a page is kept when its shape held for one turn
    await page.goto('https://jobs.example.test/o/role/apply');
    for (let i = 0; i < 3; i++) await journey.tick();
    const pages = journey.write(out);
    assert.deepEqual(pages.map(item => item.url), ['https://jobs.example.test/o/role', 'https://boards.example.net/embed/job_app', 'https://jobs.example.test/o/role/apply']);
    assert.equal(pages[1].frameOf, 'https://jobs.example.test/o/role');
    for (const item of pages) assert.ok(fs.existsSync(path.join(out, item.file)), item.file);
    const frame = fs.readFileSync(path.join(out, pages[1].file), 'utf8');
    assert.match(frame, /First name/);
    assert.ok(!/typed/.test(frame), 'a value typed into the page is never kept');
    assert.match(fs.readFileSync(path.join(out, pages[0].file), 'utf8'), /Rôle/, 'every page goes through the scrub');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, 'journey.json'), 'utf8')), pages);
  } finally { await browser.close(); }
});
