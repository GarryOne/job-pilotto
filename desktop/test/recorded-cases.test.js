// "Never fix the same website twice" (tools/recorded-cases.mjs): a push changing how the extension acts on pages brings its recorded page or scenario, or says why not.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {missingCase} from '../../tools/recorded-cases.mjs';
import {FLOW_FILES} from '../e2e/flows.mjs';

test('a fill or flow change without a case is stopped; a case, a scenario or a stated reason lets it through', () => {
  assert.match(missingCase(['extension/page/controls.js'], ['Fix a menu'], FLOW_FILES), /recorded page/);
  assert.match(missingCase(['extension/fill-flow.js'], [''], FLOW_FILES), /fill-flow\.js/);
  assert.equal(missingCase(['extension/page/controls.js', 'desktop/e2e/recorded/menu-1/case.json'], [''], FLOW_FILES), '');
  assert.equal(missingCase(['extension/fill-flow.js', 'desktop/test/journeys.test.js'], [''], FLOW_FILES), '');
  // A field replay alone is not proof (10 Oct 2026: an Ashby fix passed with one and never reached the Fixed-site replays list); with a recorded page it is fine.
  assert.match(missingCase(['extension/page/radios.js', 'worker/test/fixtures/fill/acme--salary.html'], ['Fix a group'], FLOW_FILES), /does not count/);
  assert.equal(missingCase(['extension/page/radios.js', 'worker/test/fixtures/fill/acme--salary.html', 'desktop/e2e/recorded/acme-1/case.json'], [''], FLOW_FILES), '');
  assert.equal(missingCase(['extension/fill-flow.js'], ['Log the press\n\nRecorded-unneeded: a log line only'], FLOW_FILES), '');
});

test('changes that do not act on pages are not asked: the app, the panel\'s looks, docs', () => {
  assert.equal(missingCase(['desktop/lib/terminals.js', 'extension/manifest.json', 'docs/x.md'], [''], FLOW_FILES), '');
});

test('the check is wired into the push hook', () => {
  assert.match(fs.readFileSync(new URL('../../tools/pre-push-check.sh', import.meta.url), 'utf8'), /node tools\/recorded-cases\.mjs --base origin\/main/);
});
