// Every task the app runs gets a row in Notion Search runs (owner's rule): its kind must have a Mode (lib/run-history.js KIND), or the
// backfill skips it and its log lives only in app.log (7 Oct 2026: Find jobs using your browser had no row, its logs were lost).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {RUN_KINDS} from '../lib/run-history.js';

test('every task kind the app runs has a Notion mode', () => {
  const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  const kinds = new Set([...main.matchAll(/pipeline\.(?:work|task)\(storage, '([a-z]+)'/g)].map(match => match[1]));
  assert.ok(kinds.has('visits') && kinds.has('tailor'), `found: ${[...kinds]}`);
  const kinded = new Set(Object.values(RUN_KINDS));
  assert.deepEqual([...kinds].filter(kind => !kinded.has(kind)), []);
});

test('a failed app task says why: its first ✗ line', async () => {
  const {failedLine} = await import('../lib/pipeline.js');
  const log = ['Reading 1 site in your browser, 2 at a time', '  ▸ opening · Tiffany & Co. · Opening in Chrome…',
    '  ✗ Tiffany & Co.: it stopped answering (nothing for 30 s) (it never started reading: is the extension on in Chrome?): skipped, you can close its tab'];
  assert.equal(failedLine(log), 'Tiffany & Co.: it stopped answering (nothing for 30 s) (it never started reading: is the extension on in Chrome?)');
  assert.equal(failedLine(['all fine']), undefined);
});

test('Run again on a browser run ticks its sites that did not finish, or all of them', async () => {
  const {rerunSites} = await import('../renderer/visits-card.js');
  const log = ['  ▸ next · Bulgari · https://www.bulgari.com', '  ▸ next · Chanel · https://www.chanel.com', '  ▸ next · Tiffany & Co. · https://www.tiffany.com',
    '  ▸ done · Bulgari · 47 jobs read', '  ▸ stopped · Tiffany & Co. · it stopped answering', '  ▸ reading · Chanel · page 3'];
  assert.deepEqual(rerunSites(log).map(site => site.name), ['Chanel', 'Tiffany & Co.']);
  assert.deepEqual(rerunSites(['  ▸ next · Bulgari · https://www.bulgari.com', '  ▸ done · Bulgari · 1 job']).map(site => site.url), ['https://www.bulgari.com']);
  assert.deepEqual(rerunSites(['nothing']), []);
});
