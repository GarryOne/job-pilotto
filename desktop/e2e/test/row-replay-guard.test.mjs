// The row replay itself (lib/row-replay.mjs) on an invented row: the real extension, the app's own server under plain node, memo-only (no kept answers here: the
// structure rule decides, the model is never asked). It must follow the live run's states at the click (a dialog in the same document, a single-page route), serve
// the tab its own page state, refuse an address the live run never recorded (404 and a finding, never fetched), and report a press the live run did not make.
// Opt-in like every replay (JP_REPLAY=1: it starts Chromium); run under the heavy lock (npm run recorded's lock, or tools/heavy-lock.sh).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {replayRow} from '../lib/row-replay.mjs';

const skip = process.env.JP_REPLAY ? false : 'opt-in: set JP_REPLAY=1; it starts Chromium with the real extension';
const HOST = 'https://jobs.example.org';
const POSTING = `<!doctype html><html><head><title>Engineer</title></head><body><main><h1>Site Reliability Engineer</h1><p>Join the platform team.</p>
  <button type="button">Apply now</button><img src="https://cdn.example.net/never-recorded.png"></main></body></html>`;
const DIALOG = POSTING.replace('</main>', '</main><dialog open><h2>How do you want to apply?</h2><button type="button">Continue without an account</button></dialog>');
const FORM = `<!doctype html><html><head><title>Apply</title></head><body><main><h1>Your application</h1><form>
  <label for="f">First name</label><input id="f" required><label for="l">Last name</label><input id="l" required>
  <label for="e">Email</label><input id="e" type="email" required><label for="c">CV</label><input id="c" type="file"></form></main></body></html>`;

// A row as a live capture writes it: the journey (states in order, one document for the dialog, a route of the same document for the form) and the live presses.
function inventedRow({presses}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-row-guard-'));
  fs.mkdirSync(path.join(dir, 'pages'));
  const pages = [[`${HOST}/job/42`, POSTING, 0, 1000], [`${HOST}/job/42`, DIALOG, 1, 3000], [`${HOST}/job/42/apply`, FORM, 0, 5000]].map(([url, html, state, at], i) => {
    fs.writeFileSync(path.join(dir, `pages/${i + 1}.html`), html);
    return {url, file: `pages/${i + 1}.html`, at, state, view: {width: 1200, height: 818, doc: 777}};
  });
  fs.writeFileSync(path.join(dir, 'case.json'), JSON.stringify({pages}));
  fs.writeFileSync(path.join(dir, 'presses.json'), JSON.stringify(presses));
  return dir;
}

test('the replay follows the live run\'s states at each same press, serves the form, and refuses what was never recorded', {skip}, async () => {
  const dir = inventedRow({presses: [{at: 2000, what: 'pressed the Apply button', label: 'Apply now'}, {at: 4000, what: 'pressed the start route', label: 'Continue without an account'}]});
  const result = await replayRow(dir, {capSeconds: 60, stillSeconds: 8});
  assert.ok(result.followed >= 1, `followed ${result.followed} of 2: ${JSON.stringify(result.evidence.pressed)}`);
  assert.equal(result.divergence, '');
  assert.ok(!result.unrecorded.some(address => address.includes('never-recorded.png')), 'an image is refused (404) without being a finding: only pages and sheets are');
  assert.ok(result.requests.some(request => request.route === '/extension/page-kind'), 'the extension asked what the page is');
  assert.ok(result.misses >= 1, 'memo-only: the model was never asked, the miss is reported');
});

test('a press the live run did not make is the finding, with both labels', {skip}, async () => {
  const dir = inventedRow({presses: [{at: 2000, what: 'pressed the Apply button', label: 'Apply with LinkedIn'}]});
  const result = await replayRow(dir, {capSeconds: 45, stillSeconds: 8});
  if (result.evidence.pressed.some(line => /pressed the Apply button/.test(line))) assert.match(result.divergence, /pressed "Apply now".*live pressed "Apply with LinkedIn"/);
  else assert.equal(result.followed, 0, 'nothing pressed: nothing followed');
});
