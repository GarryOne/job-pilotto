// The recording workflow was "Pool smoke" (pool-smoke.yml) until 15 Oct 2026 (owner: its one job is recording). The old name may stay ONLY where an earlier run's data is still read
// (14 days of artifacts: the site ledger and each row's last CI run, the waiting queue, the records the replay fetches). A new mention anywhere else fails here, and each reader must read BOTH names,
// or the rename would silently drop today's ledger (a host visited twice would be visited again).
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(new URL('../../..', import.meta.url).pathname);
const READERS = ['.github/workflows/record-sites.yml', 'desktop/e2e/captures.mjs', 'desktop/e2e/net-records-fetch.sh', 'desktop/e2e/pool-ci-wait.mjs'];
const ALLOWED = [...READERS, 'tests/test_red_main.py', 'desktop/e2e/test/record-sites-rename.test.mjs'];
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('the workflow file is record-sites.yml; the old name is only in the readers of earlier runs', () => {
  assert.ok(fs.existsSync(path.join(ROOT, '.github/workflows/record-sites.yml')));
  assert.ok(!fs.existsSync(path.join(ROOT, '.github/workflows/pool-smoke.yml')));
  assert.match(read('.github/workflows/record-sites.yml'), /^name: CI · Record sites \(by hand\)/m);
  const files = execFileSync('git', ['grep', '-l', '-i', '-E', 'pool-smoke|pool smoke', '--', '.', ':!docs/superpowers'], {cwd: ROOT, encoding: 'utf8'}).split('\n').filter(Boolean);
  assert.deepEqual(files.filter(file => !ALLOWED.includes(file)), [], 'the old name outside the readers of earlier runs');
});

test('every reader of earlier runs reads the new name AND the old one', () => {
  for (const file of READERS) {
    const text = read(file);
    assert.match(text, /record-sites|Record sites/, `${file}: the new name`);
    assert.match(text, /pool-smoke|Pool smoke/, `${file}: the old name (runs of the last 14 days)`);
  }
  assert.match(read('.github/workflows/record-sites.yml'), /pool-smoke-state-\$id/, 'the old state artifact name');
});
