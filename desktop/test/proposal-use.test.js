// What people do with a proposed answer, counted as fixed words (lib/proposal-use.js), so the digest shows per release whether the
// proposals improve (owner, 9 Oct 2026). Every source the session page can show is one of the counted words; nothing else leaves the Mac.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {ACTS, SOURCES, actOf, cleanUse} from '../lib/proposal-use.js';
import {pickProposal} from '../renderer/proposal-pick.js';
import {createReporter} from '../lib/recipes.js';
import {createStorage} from '../lib/storage.js';

const fakeCrypto = {encrypt: v => v, decrypt: v => v};

test('only fixed words pass: a board, a source, an act and a version; never a value or a label', () => {
  assert.deepEqual(cleanUse({board: 'h:c1c2a7e7e0', source: 'fill_guess', act: 'used', v: '0.9.126', value: 'Nyon', label: 'Localité'}),
    {board: 'h:c1c2a7e7e0', source: 'fill_guess', act: 'used', v: '0.9.126'});
  assert.equal(cleanUse({board: 'Coop Suisse', source: 'cv', act: 'used'}), null);
  assert.equal(cleanUse({board: 'ashby', source: 'guess', act: 'used'}), null);
  assert.equal(cleanUse({board: 'ashby', source: 'cv', act: 'clicked'}), null);
  assert.equal(cleanUse({board: 'ashby', source: 'cv', act: 'shown', v: 'a version with spaces'}).v, '');
  assert.deepEqual([actOf('Nyon', 'Nyon'), actOf('Gland', 'Nyon'), actOf('Gland', '')], ['used', 'edited', 'edited']);
  assert.deepEqual(ACTS, ['shown', 'used', 'edited']);
});

// The class, not one case: every way pickProposal can propose carries a source the counter knows (a new producer without one fails here).
test('every proposal the session page can show names its source, one of the counted words', () => {
  const label = 'Localité';
  const producers = {
    fill_guess: {proposals: [{label, value: 'Meyrin', guess: true}], label},
    fill_tried: {proposals: [{label, value: 'Meyrin'}], label},
    details: {label, key: 'location', contact: {location: 'Nyon'}},
    cv: {label, key: 'location', cv: [{field: 'location', value: 'Nyon', sure: true}]},
    profile: {label, key: 'location', cv: [{field: 'location', value: 'Nyon', sure: false, source: 'profile'}]},
    empty: {label, key: 'location'},
  };
  assert.deepEqual(Object.keys(producers), SOURCES);
  for (const [source, ask] of Object.entries(producers)) assert.equal(pickProposal(ask).source, source, source);
});

test('the reporter counts each use by board, source, act and version, and sends them in one batch', async () => {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-propuse-')), fakeCrypto);
  const sent = [];
  const fetcher = async (url, init) => { if (init?.body) sent.push(JSON.parse(init.body)); return {ok: true, status: 200, json: async () => ({token: 't'})}; };
  const reporter = createReporter(storage, {fetcher, base: 'https://site.test', setTimer: () => ({})});
  const use = {board: 'h:c1c2a7e7e0', source: 'fill_guess', v: '0.9.126'};
  reporter.proposalUse({...use, act: 'shown'}); reporter.proposalUse({...use, act: 'shown'}); reporter.proposalUse({...use, act: 'used'});
  reporter.proposalUse({...use, act: 'used', value: 'never sent', source: 'not a source'});
  await reporter.flush();
  const body = sent.find(item => item.proposalUses);
  assert.deepEqual(body.proposalUses, [{...use, act: 'shown', n: 2}, {...use, act: 'used', n: 1}]);
  assert.ok(!JSON.stringify(body).includes('never sent'));
});
