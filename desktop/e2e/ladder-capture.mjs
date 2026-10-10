/* global document, location */
// Fills the `sketch` of each ladder fixture (desktop/e2e/ladder-fixtures/<id>.json) with the page sketch exactly as the extension builds it: it runs the extension's OWN builder functions
// (extension/fill-flow.js pageSketchOf, extension/ladder/outcomes.js mailsOf, read from their source) in a bare headless Chromium, with no extension, no profile and no app.
//   capture.page: a page of this repo (relative to desktop/e2e/), loaded from disk with the network blocked.
//   capture.url:  a public posting, read once (a plain GET, nothing pressed, nothing typed); the sketch is stored without its query string, with any email turned into contact@example.com.
//   node desktop/e2e/ladder-capture.mjs [--only <id>] [--force] [--candidates] [--dir <fixtures folder>]      Used when a fixture is added or a page changed; the committed sketch is what the tests use.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import {DIR, loadFixtures} from './lib/ladder-fixtures.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const E2E = path.dirname(fileURLToPath(import.meta.url));
const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;

// The body of the `func: () => {…}` that follows `marker` in an extension source file.
export function builderSource(file, marker) {
  const text = fs.readFileSync(path.join(ROOT, 'extension', file), 'utf8');
  const start = text.indexOf('func: () => {', text.indexOf(marker));
  const end = text.indexOf('}}).then(rows', start);
  if (start < 0 || end < 0) throw new Error(`cannot find the builder after "${marker}" in extension/${file}`);
  return `(() => {${text.slice(start + 'func: () => {'.length, end)}})()`;
}
const noEmail = value => (typeof value === 'string' ? value.replace(EMAIL, email => (/@example\.(com|org|net|ch)$/i.test(email) ? email : 'contact@example.com'))
  : Array.isArray(value) ? value.map(noEmail) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, noEmail(item)])) : value);

const PHONE = /\+?\d[\d\s().\/-]{6,}\d/g;
const noPhone = value => (typeof value === 'string' ? value.replace(PHONE, number => (number.replace(/\D/g, '').length >= 8 ? '(phone)' : number)) : Array.isArray(value) ? value.map(noPhone)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, noPhone(item)])) : value);
// The numbered candidates of rung 3 (extension/ladder/rung3-candidates.js, a classic page script): run in the page as the extension would.
export const candidatesOfPage = page => page.evaluate(`${fs.readFileSync(path.join(ROOT, 'extension/ladder/rung3-candidates.js'), 'utf8')}\nwindow.__jobPilottoCandidates.candidatesOf()`);

export async function sketchOf(page) {
  const sketch = await page.evaluate(builderSource('fill-flow.js', 'function pageSketchOf'));
  sketch.mails = await page.evaluate(builderSource('ladder/outcomes.js', 'export function mailsOf'));
  return sketch;
}

async function main() {
  const args = process.argv.slice(2), arg = name => (args.includes(name) ? args[args.indexOf(name) + 1] : '');
  const dir = arg('--dir') || DIR, only = arg('--only');
  const browser = await chromium.launch({headless: true});
  try {
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
        const candidates = noPhone(noEmail(await candidatesOfPage(page)));
        const fresh = args.includes('--candidates') && fixture.sketch ? null : noEmail(await sketchOf(page));   // --candidates keeps the sketch (a real page changes) and only adds the numbered candidates
        await context.close();
        const sketch = fresh || fixture.sketch;
        const file = path.join(dir, fixture.file), {file: _, ...kept} = fixture;
        fs.writeFileSync(file, `${JSON.stringify({...kept, ...(detected ? {lang: detected} : {}), sketch: fresh ? {url: fixture.capture.page ? fixture.url || fixture.sketch?.url || '' : url, ...fresh} : fixture.sketch, candidates}, null, 1)}\n`);
        console.log(`${fixture.id}: ${sketch.controls.length} controls, ${sketch.buttons.length} buttons, ${sketch.headings.length} headings, ${sketch.mails.length} addresses, ${sketch.frames.length} frames`);
      } catch (error) { console.log(`FAILED ${fixture.id}: ${String(error.message).split('\n')[0]}`); }
    }
  } finally { await browser.close(); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exit(1); });
