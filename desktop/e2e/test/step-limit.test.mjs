// A step that never ends fails at its limit with which side of the app still answers, instead of the CI job dying silently (lib/runner.mjs).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRunner, hangReport, withLimit} from '../lib/runner.mjs';

const never = () => new Promise(() => {});
const session = {page: {evaluate: never}, app: {evaluate: async () => 1}, shot: async () => {}, keepLogs: async () => {}};

test('a hung step fails at its limit and says which side does not answer', async () => {
  await assert.rejects(withLimit(never(), 50, 'x', () => session), /did not finish.*the window does NOT answer, the main process answers/);
  assert.equal(await withLimit(Promise.resolve(7), 50, 'x'), 7);
});

test('the runner records the hang as a failed step and goes on when keepGoing', async () => {
  const runner = createRunner(() => session, {keepGoing: true});
  await runner.run('hangs', never, {limitMs: 50});
  await runner.run('next', async () => {});
  assert.deepEqual(runner.results.map(result => [result.name, result.status]), [['hangs', 'failed'], ['next', 'passed']]);
  assert.match(runner.results[0].note, /it hung/);
  assert.match(await hangReport(null), /no app session/);
});
