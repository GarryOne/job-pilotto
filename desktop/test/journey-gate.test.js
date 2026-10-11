// The journey gate (tools/journey-gate.mjs): which pushes it checks, and that the tests it runs exist.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {failedCases, touchedFlowFiles} from '../../tools/journey-gate.mjs';
import {FLOW_CORE, FLOW_FILES, JOURNEY_TESTS} from '../e2e/flows.mjs';

test('a push touching any flow file is checked, an extension-only one included; one touching none is not', () => {
  assert.deepEqual(touchedFlowFiles(['extension/account-step.js', 'README.md'], FLOW_FILES), ['extension/account-step.js']);
  assert.deepEqual(touchedFlowFiles(['desktop/test/journeys.test.js'], FLOW_FILES), ['desktop/test/journeys.test.js']);
  assert.deepEqual(touchedFlowFiles(['site/src/index.js', 'docs/x.md'], FLOW_FILES), []);
  for (const file of FLOW_CORE) assert.deepEqual(touchedFlowFiles([file], FLOW_FILES), [file], file);
});

test('every journey test file exists, and the gate is wired into the push hook', () => {
  for (const file of JOURNEY_TESTS) assert.ok(fs.existsSync(new URL(`../${file}`, import.meta.url)), file);
  const hook = fs.readFileSync(new URL('../../tools/pre-push-check.sh', import.meta.url), 'utf8');   // the gate runs beside the suites (gate_run), always against origin/main
  assert.match(hook, /gate_run journey-gate "journey gate" tools\/journey-gate\.mjs/);
  assert.match(hook, /node "\$3" --base origin\/main/);
});

test('a failed recorded case is named from the TAP line, so it can be retried alone and reported as flaky', () => {
  const tap = ['ok 1 - two-apply-routes-1: two routes', 'not ok 25 - workday-start-dialog-1: a start dialog offering manual', '# fail 1', 'not ok 26 - workday-start-dialog-2: a link-styled button', 'not ok 25 - workday-start-dialog-1: again'].join('\n');
  assert.deepEqual(failedCases(tap), ['workday-start-dialog-1', 'workday-start-dialog-2']);
  assert.deepEqual(failedCases(''), []);
  assert.match(fs.readFileSync(new URL('../../tools/journey-gate.mjs', import.meta.url), 'utf8'), /FLAKY under load/);
});

test('the local push gate opens no browser: the recorded pages replay only on request (JP_GATE_REPLAY=1); CI replays them all after the push', async () => {
  const {replayWanted} = await import('../../tools/journey-gate.mjs');
  const touched = ['extension/flow.js'];
  assert.equal(replayWanted({}, touched), false, 'no env: no replay, no browser, no heavy lock');
  assert.equal(replayWanted({JP_GATE_REPLAY: '1'}, touched), true);
  assert.equal(replayWanted({JP_GATE_REPLAY: '1'}, ['desktop/lib/apply.js']), false, 'a change outside the extension has nothing to replay');
  assert.equal(replayWanted({JP_GATE_FULL: '1'}, touched), true, 'the old full run replays');
  assert.equal(replayWanted({PUSH_FULL: '1'}, touched), true);
});
