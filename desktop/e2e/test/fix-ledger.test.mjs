// The fix ledger (lib/fix-ledger.mjs) behind /admin/applying's Fixed tab: built from commit trailers and desktop/e2e/pool-fixes.json, only a site name, a short hash,
// a version, a rung and ids leave the Mac (never an address, a query, a session name), claims are names and since, nothing is sent from CI.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import {test} from 'node:test';
import {FIXES_FILE, buildLedger, claimRows, cleanRow, uploadLedger} from '../lib/fix-ledger.mjs';
import {poolRowProblem} from '../../../tools/rung-trailer.mjs';

const HASH = 'a'.repeat(40), OTHER = 'b'.repeat(40);
const fakeGit = (...args) => {
  const [command, ...rest] = args, last = rest.at(-1);
  if (command === 'rev-parse') return (rest.find(arg => /^(fdbdc23|nothere)/.test(arg)) || '').startsWith('fdbdc23') ? HASH + '\n' : (() => { throw new Error('unknown'); })();
  if (command === 'log' && rest.includes('--grep=^Pool-row:')) return `${OTHER}\0Apply: a thing\n\nPool-row: Swatch Group careers\nPool-row: https://x.com/job?id=1\nRung: 3\nFixture: cand-swatch, none\x01`;
  if (command === 'log' && rest.includes('--format=%cI')) return last === HASH ? '2026-10-11T00:41:50+02:00\n' : '2026-10-11T01:00:00+02:00\n';
  if (command === 'log') return last === HASH ? 'Fix\n\nRung: 2\nFixture: hornbach-successfactors\n' : 'Fix\n\nRung: 3\nFixture: cand-swatch-group-careers, none: nothing\n';
  if (command === 'show' && rest[0] === '--name-only') return last === HASH ? 'desktop/e2e/recorded/named-control-absent-1/case.json\ndesktop/e2e/recorded/named-control-absent-1/form.html\nextension/x.js\n' : '';
  if (command === 'show') return JSON.stringify({version: last.startsWith(HASH) ? '0.9.181' : '0.9.182'});
  throw new Error('unexpected git ' + args.join(' '));
};

test('the ledger joins the data file and the Pool-row trailers: version from the commit, guard from its Fixture trailer and the recorded cases it adds', () => {
  const ledger = buildLedger({git: fakeGit, fixes: [{commit: 'fdbdc23', site: 'Hornbach SuccessFactors'}, {commit: 'nothere', site: 'Gone'}]});
  assert.deepEqual(ledger.map(item => [item.site, item.commit, item.extensionVersion, item.rung, item.guard]), [
    ['Hornbach SuccessFactors', 'aaaaaaa', '0.9.181', '2', ['recorded:named-control-absent-1', 'fixture:hornbach-successfactors']],
    ['Swatch Group careers', 'bbbbbbb', '0.9.182', '3', ['fixture:cand-swatch-group-careers']]]);   // an unknown commit is dropped; an address as a Pool-row is dropped; "none" is no fixture
});

test('privacy: nothing but fixed words leaves the Mac, no address, no query string, no session name', () => {
  assert.equal(cleanRow('https://jobs.x.com/job/1?token=abc'), ''); assert.equal(cleanRow('Site ?q=1'), ''); assert.equal(cleanRow('a@b.com'), ''); assert.equal(cleanRow('Hornbach SuccessFactors'), 'Hornbach SuccessFactors');
  const rows = claimRows([{name: 'Hornbach SuccessFactors', session: 'job-pilotto-81', at: Date.parse('2026-10-11T06:00:00Z')}, {name: 'e2e-page', session: 'x', at: 1}, {name: 'flow-core', session: 'y', at: 1}]);
  assert.deepEqual(rows, [{name: 'Hornbach SuccessFactors', since: '2026-10-11T06:00:00.000Z'}]);   // names and since only; the locks are not rows
  const text = JSON.stringify([buildLedger({git: fakeGit, fixes: []}), rows]);
  assert.doesNotMatch(text, /https?:|\?|job-pilotto-\d|@/);
});

test('the data file: every commit exists on main and its site is a plain name (skipped on a shallow clone)', () => {
  const {fixes} = JSON.parse(fs.readFileSync(FIXES_FILE, 'utf8'));
  assert.ok(fixes.length >= 7);
  for (const item of fixes) { assert.match(item.commit, /^[0-9a-f]{7,40}$/); assert.equal(cleanRow(item.site), item.site); }
  let shallow = 'true'; try { shallow = execFileSync('git', ['rev-parse', '--is-shallow-repository'], {encoding: 'utf8'}).trim(); } catch { /* no git */ }
  if (shallow !== 'false') return;
  const ledger = buildLedger({});
  for (const item of fixes) assert.ok(ledger.some(entry => entry.commit === item.commit.slice(0, 7) && entry.site === item.site), `${item.commit} is not in the history`);
  assert.ok(ledger.every(entry => entry.extensionVersion && entry.landedAt), 'every fix has its version and date');
});

test('the upload sends the ledger then the claims, as kinds fixes and claims, never from CI', async () => {
  const sent = [];
  const fetcher = async (url, init) => { sent.push(JSON.parse(init.body)); return {ok: true, json: async () => ({ok: true, stored: 1})}; };
  const out = await uploadLedger({env: {}, key: 'K', fetcher, ledger: [{site: 'A', commit: 'aaaaaaa'}], claims: []});
  assert.deepEqual(sent.map(item => [item.kind, item.rows.length]), [['fixes', 1], ['claims', 0]]);
  assert.match(out, /fixes row\(s\) sent/);
  assert.match(await uploadLedger({env: {CI: '1'}, ledger: [], claims: []}), /not sent \(CI\)/);
});

test('a Pool-row trailer is optional, and refused when it holds an address or a query string', () => {
  assert.equal(poolRowProblem(['Fix\n\nRung: 2']), '');
  assert.equal(poolRowProblem(['Fix\n\nPool-row: Hornbach SuccessFactors']), '');
  assert.match(poolRowProblem(['Fix\n\nPool-row: https://x.com/a?b=1']), /no address/);
  assert.match(poolRowProblem(['Fix\n\nPool-row: ']), /Pool-row/);
});
