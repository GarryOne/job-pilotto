// "Never fix the same website twice" (tools/recorded-cases.mjs): a push changing how the app acts on pages brings its recorded page or scenario, or says why not (never with a seen failure behind it).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {casesOf, missingCase} from '../../tools/recorded-cases.mjs';
import {replayFiles} from '../../tools/replay-files.mjs';
import {FLOW_FILES} from '../e2e/flows.mjs';

const covered = replayFiles(fileURLToPath(new URL('../..', import.meta.url)));
const commit = (files, message = '') => ({files, message});

test('a fill or flow change without a case is stopped; a case, a scenario or a stated reason lets it through', () => {
  assert.match(missingCase([commit(['extension/page/controls.js'], 'Fix a menu')], covered), /recorded page/);
  assert.match(missingCase([commit(['extension/fill-flow.js'])], covered), /fill-flow\.js/);
  assert.equal(missingCase([commit(['extension/page/controls.js', 'desktop/e2e/recorded/menu-1/case.json'])], covered), '');
  assert.equal(missingCase([commit(['extension/fill-flow.js', 'desktop/test/journeys.test.js'])], covered), '');
  // A field replay alone is not proof (10 Oct 2026: an Ashby fix passed with one and never reached the Fixed-site replays list); with a recorded page it is fine.
  assert.match(missingCase([commit(['extension/page/radios.js', 'worker/test/fixtures/fill/acme--salary.html'], 'Fix a group')], covered), /does not count/);
  assert.equal(missingCase([commit(['extension/page/radios.js', 'worker/test/fixtures/fill/acme--salary.html', 'desktop/e2e/recorded/acme-1/case.json'])], covered), '');
  assert.equal(missingCase([commit(['extension/fill-flow.js'], 'Log the press\n\nRecorded-unneeded: a log line only')], covered), '');
});

test('hole 1: every file a replay loads is covered, found by structure (the class, not a list)', () => {
  // The files the old gate missed: the consent, popup and dialog scripts and a desktop/lib rung the replay's app runs.
  for (const file of ['extension/consent.js', 'extension/popup-guard.js', 'extension/dialog-after-fill.js', 'desktop/lib/ladder/rung2-sketch.js', 'desktop/lib/server.js']) {
    assert.ok(covered.has(file), `${file} is loaded by a replay and must be covered`);
    assert.match(missingCase([commit([file], 'Fix it')], covered), /recorded page/, file);
  }
  // Every extension script the manifest's service worker or the page-file lists reach is covered; the flow's extension files all are.
  for (const file of FLOW_FILES.filter(one => one.startsWith('extension/'))) assert.ok(covered.has(file), `${file} (FLOW_FILES) is not found by the structure walk`);
  const pageFiles = fs.readdirSync(new URL('../../extension/page/', import.meta.url)).filter(name => name.endsWith('.js'));
  for (const name of pageFiles) assert.ok(covered.has(`extension/page/${name}`), `extension/page/${name} is not reached from the manifest: the replay would never load it, or the walk misses a file list`);
  // Flow files the replay's app does not load (the Electron main process registers them) cannot be proven by a replay: named here so a change shows up.
  const unloaded = FLOW_FILES.filter(file => !covered.has(file)).sort();
  assert.deepEqual(unloaded, ['desktop/lib/apply-handlers.js', 'desktop/lib/browser-handlers.js', 'desktop/lib/ext-server-handlers.js', 'desktop/lib/form-tab.js', 'desktop/lib/journey-identity.js', 'desktop/lib/kit-handlers.js', 'desktop/lib/review.js', 'desktop/lib/session-flow.js', 'desktop/lib/session-handlers.js']);
  // The harness, tools and tests are not covered: they may say Recorded-unneeded (or nothing).
  for (const file of ['desktop/e2e/lib/live-row.mjs', 'tools/ship.sh', 'desktop/test/x.test.js', 'docs/x.md', 'extension/manifest.json']) assert.ok(!covered.has(file), file);
});

test('hole 2: "Recorded-unneeded" cannot excuse a fix to a seen failure', () => {
  const unneeded = 'Recorded-unneeded: log only';
  // f3e4596's shape: a filler change that fixes a pool row, with the excuse added.
  const refused = missingCase([commit(['extension/page/fill-menus.js'], `Menus that load page by page\n\n${unneeded}\nPool-row: Breitling SuccessFactors`)], covered);
  assert.match(refused, /Recorded-unneeded:" is refused/);
  assert.match(missingCase([commit(['extension/page/fill-menus.js'], `Fix\n\nFixes #412\n${unneeded}`)], covered), /refused/);
  assert.match(missingCase([commit(['desktop/lib/ladder/rung2-sketch.js'], `Fix\n\nRefs #9\n${unneeded}`)], covered), /refused/);
  // 5b9a14c's shape: harness only, a pool row, the excuse: allowed. A covered refactor with the excuse and no failure: allowed.
  assert.equal(missingCase([commit(['desktop/e2e/lib/live-row.mjs', 'desktop/e2e/live.mjs'], `A live row\n\n${unneeded}\nPool-row: FNAC Suisse jobs, French`)], covered), '');
  assert.equal(missingCase([commit(['extension/page/fill-menus.js'], `Rename a helper\n\n${unneeded}`)], covered), '');
  // The excuse is per commit: a harmless commit's excuse does not cover another commit's fix in the same push; a case in the push does.
  assert.match(missingCase([commit(['extension/log.js'], `Log\n\n${unneeded}`), commit(['extension/page/radios.js'], 'Fix a group\n\nPool-row: X')], covered), /recorded page/);
  assert.equal(missingCase([commit(['extension/page/fill-menus.js', 'desktop/e2e/recorded/menus-1/case.json'], `Fix\n\n${unneeded}\nPool-row: Breitling SuccessFactors`)], covered), '');
});

test('the push\'s own recorded cases are named, for the fails-on-old replay', () => {
  assert.deepEqual(casesOf(['desktop/e2e/recorded/a-1/case.json', 'desktop/e2e/recorded/a-1/pages/1.html', 'desktop/e2e/recorded/b-1/case.json', 'extension/log.js', 'desktop/test/journeys.test.js']), ['a-1', 'b-1']);
});

test('the check is wired into the push hook', () => {
  assert.match(fs.readFileSync(new URL('../../tools/pre-push-check.sh', import.meta.url), 'utf8'), /node tools\/recorded-cases\.mjs --base origin\/main/);
});
