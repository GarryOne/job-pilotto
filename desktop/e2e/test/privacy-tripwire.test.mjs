// The privacy tripwire (lib/privacy-tripwire.mjs; owner's rule: tests never touch the owner's real data; 11 Oct 2026: the plan's claude -p carries the signed-in
// account, and a held fill on a real site typed the owner's first name, guessed from the account e-mail, into the fake applicant's form). After every held fill of a
// live run, what the page holds in its fields is compared with the owner's own values (his app's profile and answers, the Claude account e-mail and the name words in
// it); a match fails the run and deletes what it saved (capture, candidate, evidence). Values are compared on this Mac and never printed: only kinds and field labels.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {matchesOwner, ownerValues, pageFields, tripwire} from '../lib/privacy-tripwire.mjs';

const E2E = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// An invented owner (never the real one): what his app's files and his Claude account would give.
const OWNER = ownerValues({texts: ['# Profile\nName: Ana Maria Popescu\nEmail: ana.popescu@gmail.com\nPhone: +41 79 555 12 34'], accountEmail: 'anapopescu88@gmail.com'});

test('the owner\'s values: profile emails, phone digits, name words, and the account e-mail with the name words read off it', () => {
  const kinds = [...OWNER.values()];
  assert.ok(kinds.includes('email') && kinds.includes('phone') && kinds.includes('name') && kinds.includes('account'));
  assert.ok(OWNER.has('anapopescu88@gmail.com'), 'the account e-mail itself');
  assert.ok([...OWNER.keys()].some(value => value === 'anapopescu'), 'the name read off the account e-mail (letters only, 3+)');
});

test('a typed value that is the owner\'s is caught, whatever the field; the fake applicant\'s are not; only kinds and labels come back', () => {
  const typed = [
    {label: 'First name', value: 'Test'}, {label: 'Last name', value: 'Candidate'}, {label: 'Email', value: 'test.candidate@example.com'},
    {label: 'Preferred name', value: 'Ana'}, {label: 'Contact email', value: 'ANA.POPESCU@gmail.com'}, {label: 'Mobile', value: '079 555 12 34'},
    {label: 'Cover note', value: 'Hello, I am anapopescu88@gmail.com'}, {label: 'City', value: 'Anaheim'},
  ];
  const found = matchesOwner(typed, OWNER);
  assert.deepEqual(found.map(hit => hit.label).sort(), ['Contact email', 'Cover note', 'Mobile', 'Preferred name']);
  assert.ok(found.every(hit => Object.keys(hit).sort().join() === 'kind,label'), 'never the value');
  assert.deepEqual(matchesOwner(typed.slice(0, 3), OWNER), [], 'the fake applicant passes');
});

test('a match fails the run, deletes what it saved, and says which kinds in which fields without a value', async () => {
  const saved = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-tripwire-')), candidate = path.join(saved, 'candidate'), evidence = path.join(saved, 'evidence');
  for (const dir of [candidate, evidence]) { fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, 'page.html'), '<p>x</p>'); }
  const page = {typed: async () => [{label: 'Preferred name', value: 'Ana'}]};
  const result = await tripwire(page, {values: OWNER, saved: [candidate, evidence]});
  assert.equal(result.ok, false);
  assert.match(result.reason, /privacy tripwire: name typed into "Preferred name"/);
  assert.doesNotMatch(result.reason, /Ana\b/);
  assert.equal(fs.existsSync(candidate) || fs.existsSync(evidence), false, 'the run\'s saved files are gone');
  const clean = await tripwire({typed: async () => [{label: 'First name', value: 'Test'}]}, {values: OWNER, saved: [saved]});
  assert.equal(clean.ok, true);
  assert.equal(fs.existsSync(saved), true, 'a clean run keeps its files');
});

test('without the owner\'s values (a CI runner, a fresh Mac) the tripwire still runs on the account e-mail, and says what it checked', () => {
  const none = ownerValues({texts: [], accountEmail: ''});
  assert.equal(none.size, 0);
  assert.ok(ownerValues({texts: [], accountEmail: 'x.y@example.org'}).size >= 1);
});

// Every live run goes through runLive (lib/apply-live.mjs), which calls the tripwire after its held fill; anything else that opens a live posting must go through it.
// Left out on purpose: twin.mjs (the owner's own twin app: his real details are its point, docs/live-test.md); lib/page-replay.mjs and lib/row-replay.mjs (offline:
// fake pages and the fake applicant, no real site).
test('every live run passes the tripwire: runLive calls it, and every opener of a live posting goes through runLive', () => {
  const files = ['', 'lib', 'suites'].flatMap(dir => fs.readdirSync(path.join(E2E, dir)).filter(f => f.endsWith('.mjs')).map(f => (dir ? `${dir}/${f}` : f)));
  const text = file => fs.readFileSync(path.join(E2E, file), 'utf8');
  assert.match(text('lib/apply-live.mjs'), /tripwire\(/, 'runLive does not call the tripwire');
  const openers = files.filter(f => /livePosting\(/.test(text(f)) && !['lib/live-posting.mjs', 'lib/apply-live.mjs'].includes(f));
  for (const file of openers) assert.match(text(file), /runLive\(/, `${file} opens a live posting without runLive (the tripwire)`);
});

let chromium = null;
try { ({chromium} = await import('playwright-core')); if (!fs.existsSync(chromium.executablePath())) chromium = null; } catch { /* no playwright */ }

test('in a real page: fields in the page, a shadow root and a frame are read and cleared; a password field is never read', {skip: !chromium && 'no Chromium'}, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route('https://jobs.example.org/**', route => route.fulfill({contentType: 'text/html', body: route.request().url().endsWith('/frame')
      ? '<label for="c">City of birth</label><input id="c" value="Popescu town">'
      : `<label for="f">First name</label><input id="f" value="Test"><label for="n">Preferred name</label><input id="n" value="Ana">
         <label for="p">Password</label><input id="p" type="password" value="Ana">
         <div id="host"></div><iframe src="https://jobs.example.org/frame"></iframe>
         <script>document.getElementById('host').attachShadow({mode: 'open'}).innerHTML = '<input aria-label="Contact email" value="ana.popescu@gmail.com">';</script>`}));
    await page.goto('https://jobs.example.org/apply');
    await page.frames()[1]?.waitForLoadState().catch(() => {});
    const result = await tripwire(pageFields(page), {values: OWNER});
    assert.equal(result.ok, false);
    for (const label of ['Preferred name', 'Contact email', 'City of birth']) assert.match(result.reason, new RegExp(`"${label}"`));
    assert.doesNotMatch(result.reason, /Password/, 'a password field is never read');
    const after = await tripwire(pageFields(page), {values: OWNER});
    assert.equal(after.ok, true, `cleared: ${after.reason || ''}`);
    assert.equal(await page.inputValue('#f'), 'Test', 'the fake applicant\'s value stays');
  } finally { await browser.close(); }
});
