// The journey gate (tools/journey-gate.mjs): which pushes it checks, and that the tests it runs exist.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {touchedFlowFiles} from '../../tools/journey-gate.mjs';
import {FLOW_CORE, FLOW_FILES, JOURNEY_TESTS} from '../e2e/flows.mjs';

test('a push touching any flow file is checked, an extension-only one included; one touching none is not', () => {
  assert.deepEqual(touchedFlowFiles(['extension/account-step.js', 'README.md'], FLOW_FILES), ['extension/account-step.js']);
  assert.deepEqual(touchedFlowFiles(['desktop/test/journeys.test.js'], FLOW_FILES), ['desktop/test/journeys.test.js']);
  assert.deepEqual(touchedFlowFiles(['site/src/index.js', 'docs/x.md'], FLOW_FILES), []);
  for (const file of FLOW_CORE) assert.deepEqual(touchedFlowFiles([file], FLOW_FILES), [file], file);
});

test('every journey test file exists, and the gate is wired into the push hook', () => {
  for (const file of JOURNEY_TESTS) assert.ok(fs.existsSync(new URL(`../${file}`, import.meta.url)), file);
  assert.match(fs.readFileSync(new URL('../../tools/pre-push-check.sh', import.meta.url), 'utf8'), /node tools\/journey-gate\.mjs --base origin\/main/);
});
