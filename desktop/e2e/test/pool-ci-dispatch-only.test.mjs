// The pool's smoke starts by hand only, also on CI (owner, 11 Oct 2026 "the pool runs BY HAND only"; 12 Oct 2026 it may run on a GitHub runner, still by hand):
// every workflow that runs it is workflow_dispatch only. A schedule, push or pull_request trigger on one fails here, with the workflow's name.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('every workflow that runs the pool smoke starts by hand only: no schedule, no push, no pull_request', () => {
  const dir = path.join(REPO, '.github', 'workflows');
  const runners = fs.readdirSync(dir).filter(name => /\.ya?ml$/.test(name)).filter(name => /(^|[\s/'\"])smoke\.mjs\b|npm run smoke\b/m.test(fs.readFileSync(path.join(dir, name), 'utf8')));
  assert.ok(runners.includes('pool-smoke.yml'), `the pool's workflow is found: ${runners.join(', ')}`);
  for (const name of runners) {
    const on = fs.readFileSync(path.join(dir, name), 'utf8').match(/^on:\n((?:[ \t]+.*\n|\n)*)/m)?.[1] || '';
    const triggers = [...on.matchAll(/^ {2}([a-z_]+):/gm)].map(match => match[1]);
    assert.deepEqual(triggers, ['workflow_dispatch'], `${name} starts only by hand, not ${triggers.join(', ')}`);
  }
});
