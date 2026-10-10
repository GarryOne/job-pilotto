/* global document, location */
// Fills the `sketch` of each ladder fixture (desktop/e2e/ladder-fixtures/<id>.json) with the page sketch exactly as the extension builds it: it runs the extension's OWN builder functions
// (extension/fill-flow.js pageSketchOf, extension/ladder/outcomes.js mailsOf, read from their source) in a bare headless Chromium, with no extension, no profile and no app.
//   capture.page: a page of this repo (relative to desktop/e2e/), loaded from disk with the network blocked.
//   capture.url:  a public posting, read once (a plain GET, nothing pressed, nothing typed); the sketch is stored without its query string, with any email turned into contact@example.com.
//   --from-candidates [--day <YYYY-MM-DD>] [--candidates-dir <folder>] [--only <shape>]: the pool run's replay candidates (e2e/lib/ladder-candidates.mjs) that did NOT reach the form become fixtures with expect `pending` (the page.html
//     of the candidate, loaded from disk with the network blocked; scrubbed); a fixture that exists is kept (--force replaces it); --only takes a candidate whatever it reached.
//   node desktop/e2e/ladder-capture.mjs [--only <id>] [--force] [--candidates] [--dir <fixtures folder>]      Used when a fixture is added or a page changed; the committed sketch is what the tests use.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';
import {CANDIDATES_DIR, candidateFixture, readCandidates, selectCandidates} from './lib/ladder-candidates.mjs';
import {DIR, loadFixtures} from './lib/ladder-fixtures.mjs';
import {noEmail, noPhone} from './lib/ladder-scrub.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const E2E = path.dirname(fileURLToPath(import.meta.url));

// The body of the `func: () => {…}` that follows `marker` in an extension source file.
export function builderSource(file, marker) {
  const text = fs.readFileSync(path.join(ROOT, 'extension', file), 'utf8');
  const start = text.indexOf('func: () => {', text.indexOf(marker));
  const end = text.indexOf('}}).then(rows', start);
  if (start < 0 || end < 0) throw new Error(`cannot find the builder after "${marker}" in extension/${file}`);
  return `(() => {${text.slice(start + 'func: () => {'.length, end)}})()`;
}
// The numbered candidates of rung 3 (extension/ladder/rung3-candidates.js, a classic page script): run in the page as the extension would.
export const candidatesOfPage = page => page.evaluate(`${fs.readFileSync(path.join(ROOT, 'extension/ladder/rung3-candidates.js'), 'utf8')}\nwindow.__jobPilottoCandidates.candidatesOf()`);

// The whole `export function <name>() {…}` of an extension file (balanced braces), as an expression to run in the page.
export function functionSource(file, header) {
  const text = fs.readFileSync(path.join(ROOT, 'extension', file), 'utf8'), start = text.indexOf(header);
  if (start < 0) throw new Error(`cannot find "${header}" in extension/${file}`);
  let depth = 0, end = -1;
  for (let at = text.indexOf('{', start); at < text.length; at++) { if (text[at] === '{') depth++; else if (text[at] === '}' && --depth === 0) { end = at + 1; break; } }
  return `(${text.slice(start, end).replace(/^export\s+/, '')})()`;
}
// What the judges are shown (extension/account-fill.js accountSketch: controls with their state, never their values), the page's own `at` positions dropped; fromPath/sameForm from the fixture (a result question).
export async function judgeSketchOf(page, capture = {}) {
  const found = await page.evaluate(functionSource('account-fill.js', 'export function accountSketch'));
  const {url: _url, ...rest} = found;   // the fixture's own url (query-free) is written by the caller
  return {...rest, controls: found.controls.map(({at: _at, ...control}) => control), ...(capture.fromPath ? {fromPath: capture.fromPath} : {}), ...(capture.sameForm ? {sameForm: capture.sameForm} : {})};
}

export async function sketchOf(page) {
  const sketch = await page.evaluate(builderSource('fill-flow.js', 'function pageSketchOf'));
  sketch.mails = await page.evaluate(builderSource('ladder/outcomes.js', 'export function mailsOf'));
  return sketch;
}

// The pool run's failed replay candidates -> pending fixtures (the sketch and the numbered candidates are built by the extension's own functions from the saved page.html, offline).
async function fromCandidates(browser, {dir, only, day, root, force}) {
  const picked = selectCandidates(readCandidates(root, {day}), {only});
  if (!picked.length) console.log(`no failed candidate in ${root}${day ? ` (${day})` : ''}${only ? ` matching ${only}` : ''}`);
  for (const item of picked) {
    const file = path.join(dir, `cand-${item.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)}.json`);
    if (fs.existsSync(file) && !force) { console.log(`kept ${path.basename(file)} (exists; --force replaces it)`); continue; }
    const context = await browser.newContext({viewport: {width: 1280, height: 900}, acceptDownloads: false});
    try {
      const page = await context.newPage();
      await page.route(url => !url.href.startsWith('file:'), route => route.abort());
      await page.goto(pathToFileURL(path.join(item.dir, 'page.html')).href, {waitUntil: 'load'});
      const lang = String(await page.evaluate(() => document.documentElement.lang || '')).slice(0, 2).toLowerCase();
      const fixture = candidateFixture({name: item.name, day: item.day, caseJson: item.caseJson, sketch: await sketchOf(page), candidates: await candidatesOfPage(page), lang});
      fs.writeFileSync(file, `${JSON.stringify(fixture, null, 1)}\n`);
      console.log(`${fixture.id}: ${fixture.sketch.controls.length} controls, ${fixture.sketch.buttons.length} buttons, ${fixture.candidates.length} candidates; run reached ${item.caseJson.run?.reached || 'nothing'}; expectation pending`);
    } catch (error) { console.log(`FAILED ${item.name}: ${String(error.message).split('\n')[0]}`); } finally { await context.close(); }
  }
}

async function main() {
  const args = process.argv.slice(2), arg = name => (args.includes(name) ? args[args.indexOf(name) + 1] : '');
  const dir = arg('--dir') || DIR, only = arg('--only');
  const browser = await chromium.launch({headless: true});
  try {
    if (args.includes('--from-candidates')) return await fromCandidates(browser, {dir, only, day: arg('--day'), root: arg('--candidates-dir') || CANDIDATES_DIR, force: args.includes('--force')});
    for (const fixture of loadFixtures(dir)) {
      if ((only && fixture.id !== only) || !fixture.capture || (fixture.sketch && !args.includes('--force') && !args.includes('--candidates') && only !== fixture.id)) continue;   // a captured sketch is kept (a real page changes): --force or --only re-reads it
      try {
        const context = await browser.newContext({viewport: {width: 1280, height: 900}, acceptDownloads: false});
        const page = await context.newPage();
        let url = fixture.sketch?.url || '';
        if (fixture.capture.page) {
          await page.route(url => !url.href.startsWith('file:'), route => route.abort());
          await page.goto(pathToFileURL(path.join(E2E, fixture.capture.page)).href, {waitUntil: 'load'});
        } else {
          await page.goto(fixture.capture.url, {waitUntil: 'domcontentloaded', timeout: 30000});
          await page.waitForTimeout(4000);
          url = (await page.evaluate(() => location.href)).split(/[?#]/)[0];
        }
        const detected = fixture.lang ? '' : String(await page.evaluate(() => document.documentElement.lang || '')).slice(0, 2).toLowerCase();   // a new fixture learns its page's language
        const judge = fixture.question && fixture.question !== 'page_kind';   // a judge question: the judges' sketch, no numbered candidates
        const candidates = judge ? undefined : noPhone(noEmail(await candidatesOfPage(page)));
        const fresh = args.includes('--candidates') && fixture.sketch ? null : noPhone(noEmail(judge ? await judgeSketchOf(page, fixture.capture) : await sketchOf(page)));   // --candidates keeps the sketch (a real page changes) and only adds the numbered candidates
        await context.close();
        const sketch = fresh || fixture.sketch;
        const file = path.join(dir, fixture.file), {file: _, ...kept} = fixture;
        fs.writeFileSync(file, `${JSON.stringify({...kept, ...(detected ? {lang: detected} : {}), sketch: fresh ? {url: fixture.capture.page ? fixture.url || fixture.sketch?.url || '' : url, ...fresh} : fixture.sketch, ...(candidates ? {candidates} : {})}, null, 1)}\n`);
        console.log(`${fixture.id}: ${sketch.controls.length} controls, ${sketch.buttons.length} buttons, ${sketch.headings.length} headings, ${sketch.mails?.length ?? 0} addresses, ${sketch.frames.length} frames${judge ? ` (${fixture.question})` : ''}`);
      } catch (error) { console.log(`FAILED ${fixture.id}: ${String(error.message).split('\n')[0]}`); }
    }
  } finally { await browser.close(); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exit(1); });
