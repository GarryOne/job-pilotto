// "Proven live" is retired (record-once spec 15 Oct 2026: a fix is confirmed OFFLINE on a recording, never by a live run): no tracked file may still use its pieces, so a new
// rule, skill, workflow or page cannot ask for a live proof again. The site's own store and column are listed until their PR removes them: the list may only shrink.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';

const root = path.resolve(import.meta.dirname, '../..');
const RETIRED = /pool-proven|unproven-fixes|uploadProven|pool-proof\.yml|PR_PROOF_ANTHROPIC_KEY|pr-live-proof|applying\/proven|applying-proven|JOB_PILOTTO_SITE_RESERVE|\bProven live\b/;
const KEEP = [/^docs\/superpowers\//, /^docs\/rules\/why\.md$/, /^site\/migrations\//, /^desktop\/test\/live-proof-retired\.test\.js$/, /^desktop\/e2e\/test\/pool-ci-triggers\.test\.mjs$/];   // history, and the guards that name what must not return
const SITE_UNTIL_ITS_PR = [/^site\//];   // the store (applying-proven.js), its route, the Fixed tab's column and their tests: the next PR removes them and this list

test('no tracked file still uses a retired live-proof piece', () => {
  const left = [];
  for (const file of execFileSync('git', ['-C', root, 'ls-files'], {encoding: 'utf8'}).split('\n').filter(Boolean)) {
    if (KEEP.some(rule => rule.test(file)) || SITE_UNTIL_ITS_PR.some(rule => rule.test(file)) || /\.(png|jpe?g|gif|ico|zip|woff2?|pdf|lock)$/i.test(file)) continue;
    let text = '';
    try { text = fs.readFileSync(path.join(root, file), 'utf8'); } catch { continue; }
    const hit = RETIRED.exec(text);
    if (hit) left.push(`${file}: ${hit[0]}`);
  }
  assert.deepEqual(left, []);
});

test('the reader finds a retired piece (positive control)', () => {
  assert.match('lib/pool-proven.mjs', RETIRED);
  assert.match('Not Proven live', RETIRED);
  assert.doesNotMatch('Confirmed offline', RETIRED);
});
