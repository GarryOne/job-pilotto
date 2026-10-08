// The Actions page's six cards (renderer/index.html): each one is wired to something that exists, and Tune's words and guard hold.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {mainSource} from './main-source.js';

import * as strategy from '../lib/strategy.js';
import {applyLabel, basisParts, proposalCounts, proposalTitle} from '../renderer/tune-text.js';

const renderer = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'renderer');
const html = fs.readFileSync(path.join(renderer, 'index.html'), 'utf8');
const activity = fs.readFileSync(path.join(renderer, 'pages', 'activity.js'), 'utf8');
const main = mainSource();

const grid = html.slice(html.indexOf('<div class="task-grid">'), html.indexOf('<section class="card runs-card">'));
const cards = grid.split('<div class="task-card">').slice(1);

test('there are six cards, an even grid', () => assert.equal(cards.length, 6));

test('every card button runs a task the app knows', () => {
  const kinds = activity.match(/export const COMMAND_KIND = \{([^}]*)\}/)[1];
  for (const card of cards) {
    const command = card.match(/data-command="(\w+)"/)?.[1];
    if (!command) { assert.match(card, /id="(tune-open|tailor-top)"/, 'a card without a command is Tune or Tailor CVs'); continue; }
    assert.match(kinds, new RegExp(`\\b${command}:`), `${command} is not a tracked task (COMMAND_KIND)`);
    assert.match(main, new RegExp(`'${command}'`), `${command} is not handled by main.js`);
  }
});

test('the cards are the agreed six, and the dropped ones stay dropped', () => {
  const titles = cards.map(card => card.match(/<div class="task-words"><b>([^<]+)<\/b>/)[1].replace('&amp;', '&'));
  assert.deepEqual(titles, ['Find new employers', 'Refresh jobs', 'Check Gmail & Calendar', 'Tailor CVs for top matches',
    'Tune my strategy', 'Analyze my job search']);
});

test('Tune words: a title per kind, the header and row counts, and Apply names how many', () => {
  assert.equal(proposalTitle({kind: 'drop_role', label: 'bi'}), 'Stop searching for “bi”');
  assert.equal(proposalTitle({kind: 'drop_place', label: 'berlin'}), 'Stop searching in “berlin”');
  assert.equal(proposalTitle({kind: 'exclude_title', label: 'marketing'}), 'Skip job titles with “marketing”');
  assert.match(basisParts({basis: {jobs: 0}, proposals: []}).lead, /No results to learn from yet/);
  assert.equal(basisParts({basis: {jobs: 0}, proposals: []}).counts, '');
  const basis = {jobs: 49, dismissed: 4, engaged: 45, interviews: 0, min_dismissed: 5};
  assert.deepEqual(basisParts({basis, proposals: [{id: 'x'}]}), {lead: 'Based on 49 jobs you acted on.', counts: '4 dismissed · 45 kept or applied · 0 interviews'});
  assert.match(basisParts({basis, proposals: []}).lead, /^Based on 49 jobs you acted on\. Nothing to change: .*5\+ dismissals/);
  assert.match(basisParts({basis: {...basis, jobs: 1, interviews: 1}, proposals: []}).lead, /1 job you acted on/);
  assert.match(basisParts({basis: {...basis, jobs: 1, interviews: 1}, proposals: []}).counts, /· 1 interview$/);
  assert.equal(proposalCounts({dismissed: 31, engaged: 0, why: 'x'}), '31 dismissed · 0 kept or applied');
  assert.equal(proposalCounts({why: 'the engine sentence'}), 'the engine sentence');
  assert.deepEqual([0, 1, 3].map(applyLabel), ['Apply changes', 'Apply 1 change', 'Apply 3 changes']);
});

test('Apply writes only what the engine offers again: a made-up or stale id changes nothing', () => {
  const fresh = [{id: 'drop_role:role_keywords:\\bbi\\b', kind: 'drop_role'}, {id: 'drop_place:abroad:berlin', kind: 'drop_place'}];
  assert.deepEqual(strategy.chooseOffered(fresh, ['drop_place:abroad:berlin']), {chosen: [fresh[1]], asked: 1});
  assert.deepEqual(strategy.chooseOffered(fresh, ['exclude_title:title_exclude_keywords:\\bpython\\b']), {chosen: [], asked: 1});
  assert.deepEqual(strategy.chooseOffered(fresh, 'not a list'), {chosen: [], asked: 0});
  assert.deepEqual(strategy.chooseOffered(undefined, ['x']), {chosen: [], asked: 1});
});
