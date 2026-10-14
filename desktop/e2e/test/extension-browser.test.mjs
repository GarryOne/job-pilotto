// E2E_BROWSER=msedge runs the extension in Edge; anything else keeps Playwright's Chromium.
import test from 'node:test';
import assert from 'node:assert/strict';
import {browserChannel} from '../lib/extension.mjs';

test('the apply suite uses Edge only when asked', () => {
  assert.deepEqual(browserChannel({E2E_BROWSER: 'msedge'}), {channel: 'msedge'});
  assert.deepEqual(browserChannel({}), {});
  assert.deepEqual(browserChannel({E2E_BROWSER: 'chrome'}), {});
});

// A fixture browser's addresses resolve to the local fixture server: they are not live visits and never reach the per-site ledger
// (12 Oct 2026: local apply runs filled jobs.lever.co's daily 3 and the next run's Lever step was refused). A real browser's are counted.
test('only a real browser counts its visits in the site ledger', async () => {
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const {visitGuard} = await import('../lib/extension.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-ledger-'));
  const env = {JOB_PILOTTO_SITE_LEDGER_DIR: dir, JOB_PILOTTO_SITE_LIMIT: '1'};
  try {
    for (let i = 0; i < 3; i++) visitGuard(false)('https://jobs.lever.co/e2e/1/apply', {env, who: 'browser'});
    assert.equal(fs.existsSync(path.join(dir, 'ledger.json')) ? Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'ledger.json'), 'utf8'))).length : 0, 0, 'a fixture visit was written to the ledger');
    visitGuard(true)('https://jobs.lever.co/e2e/1/apply', {env, who: 'twin'});
    const days = Object.values(JSON.parse(fs.readFileSync(path.join(dir, 'ledger.json'), 'utf8')));
    assert.equal(days[0]?.['jobs.lever.co']?.visits?.length, 1, 'a real browser\'s visit was not counted');
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});
