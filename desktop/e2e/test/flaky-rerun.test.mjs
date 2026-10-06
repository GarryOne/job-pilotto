// A red suite that passes when the CI job runs it again on the same commit marks its failed step flaky (e2e.yml rerun step -> flaky.json -> triage).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {normalize} from '../lib/triage.mjs';

test('a failed step from a suite that passed on its rerun is a flaky finding; one that failed again is not', () => {
  const [flaky] = normalize({suite: [{suite: 'focus', step: 'Edit target saves', message: 'Timeout', flaky: true}]}).findings ?? normalize({suite: [{suite: 'focus', step: 'Edit target saves', message: 'Timeout', flaky: true}]});
  const [real] = normalize({suite: [{suite: 'focus', step: 'Edit target saves', message: 'Timeout'}]}).findings ?? normalize({suite: [{suite: 'focus', step: 'Edit target saves', message: 'Timeout'}]});
  assert.equal(flaky.flaky, true);
  assert.ok(!real.flaky);
  assert.equal(flaky.id, real.id, 'the same issue either way: flaky is a label, not a new finding');
});

test('the workflow reruns a red suite outside the uploaded artifacts and writes flaky.json only on a pass', () => {
  const yml = fs.readFileSync(new URL('../../../.github/workflows/e2e.yml', import.meta.url), 'utf8');
  assert.match(yml, /if: failure\(\) && steps\.suite_run\.outcome == 'failure'/);
  assert.match(yml, /E2E_ARTIFACTS="\$\{\{ github\.workspace \}\}\/e2e-rerun\//);
  assert.match(yml, /then\n\s+echo '\{"rerun": "passed"\}' > "\$first\/flaky\.json"/);
});
