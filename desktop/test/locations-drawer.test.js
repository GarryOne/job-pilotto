// A job's drawer says "scored with older places" and offers that one job's Refresh (owner, 17 Oct 2026: "Each job's drawer shows 'scored with older places ·
// Refresh'; one column, repaired into older workspaces automatically"). The engine's fingerprint of today's places is asked once per change of the search
// settings, not per drawer; a score that recorded no places is never called older; the refresh takes this job only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {placesNow} from '../lib/places-now.js';
import {jobPage} from '../lib/job-page-handlers.js';
import {matchView} from '../renderer/job-page-view.js';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('today\'s places are asked of the engine once, again only when the settings file changed', async () => {
  const calls = [];
  let mtime = 1;
  const options = {run: async (_, args) => { calls.push(args.join(' ')); return {code: 0, stdout: JSON.stringify({places: `fp${calls.length}`})}; }, modified: () => mtime};
  const storage = {};
  assert.equal(await placesNow(storage, options), 'fp1');
  assert.equal(await placesNow(storage, options), 'fp1');
  assert.deepEqual(calls, ['src.desktop places-now']);
  mtime = 2;
  assert.equal(await placesNow(storage, options), 'fp2');
  assert.equal(await placesNow(storage, {...options, run: async () => ({code: 1, stdout: ''}), modified: () => 3}), '');   // an engine failure says nothing, never "older"
});

test('a job page carries today\'s places only with a match, and a failure to ask is no failure of the page', async () => {
  const call = async (_, table) => (table === 'matches' ? {url: 'https://x/1', fit: 80, places: 'old'} : {id: 'a1'});
  const page = await jobPage({}, 'https://x/1', {call, placesNow: async () => 'new'});
  assert.equal(page.placesNow, 'new');
  const broken = await jobPage({}, 'https://x/1', {call, placesNow: async () => { throw new Error('x'); }});
  assert.equal(broken.placesNow, '');
  const none = await jobPage({}, 'https://x/2', {call: async () => null, placesNow: async () => 'new'});
  assert.equal('placesNow' in none, false);
});

test('older places: a score that recorded some, different from today\'s; none recorded is never older', () => {
  const job = {fit: 80};
  assert.equal(matchView(job, {match: {places: 'old'}, placesNow: 'new'}).older_places, true);
  assert.equal(matchView(job, {match: {places: 'same'}, placesNow: 'same'}).older_places, false);
  assert.equal(matchView(job, {match: {places: ''}, placesNow: 'new'}).older_places, false);
  assert.equal(matchView(job, {match: {places: 'old'}, placesNow: ''}).older_places, false);
});

test('the drawer shows the card with a Refresh for this one job; the handler passes its URL', () => {
  const tab = read('renderer/job-drawer/tab-match.js');
  assert.match(tab, /match\.older_places/);
  assert.match(tab, /window\.pilot\.refreshLocations\(job\.url\)/);
  assert.match(read('lib/job-actions-handlers.js'), /ipcMain\.handle\('refreshLocations', async \(_, url\)[\s\S]*?'refresh-locations'[\s\S]*?--url/);
});
