// "Your own filters hide jobs" (renderer/coverage-card.js filtersCard, lib/strategy.js loosen): what an excluded title word or a ruled-out language
// costs, and removing one changes only it (6 Oct 2026: a photographer's preferences ruled out English, German, Italian and Spanish).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {filtersCard} from '../renderer/coverage-card.js';
import {loosen} from '../lib/strategy.js';

test('each filter that hid jobs is a chip with what it costs', () => {
  const card = filtersCard({at: 'x', excluded: [{fragment: '\\bsenior\\b', count: 12, examples: ['Senior Sales Associate']}],
    languages: [{language: 'english', count: 8, examples: ['Client Advisor']}]});
  assert.deepEqual(card.chips.map(chip => chip.label), ['− "senior" · 12', '− requires english · 8']);
  assert.equal(filtersCard({excluded: [], languages: []}), null);
  assert.equal(filtersCard({at: 'x', excluded: [{fragment: 'a', count: 3}]}, 'x'), null, 'Not now for this crawl');
});

test('loosen removes only what was asked, from both files, and publishes', async () => {
  const files = {'config/search.json': JSON.stringify({title_exclude_keywords: ['\\bsenior\\b', 'stage'], role_keywords: ['vendeur']}),
    'config/preferences.json': JSON.stringify({disqualifying_languages: ['english', 'german'], daily_applications_target: 5})};
  const storage = {readText: name => files[name], writeText: (name, text) => { files[name] = text; }, settings: () => ({notionIds: {NOTION_SEARCH_SETTINGS_PAGE: 'p', NOTION_PROFILE_PAGE_ID: 'r'}}), secret: () => 't'};
  const ran = [];
  const result = await loosen(storage, {excludes: ['\\bsenior\\b'], languages: ['english']},
    {run: async (_, args) => { ran.push(args.join(' ')); return {code: 0, stdout: 'page'}; }, ensurePage: async () => 'p', writePage: async () => {}, wait: async () => {}});
  assert.deepEqual(result.removed, ['\\bsenior\\b', 'english']);
  assert.deepEqual(JSON.parse(files['config/search.json']).title_exclude_keywords, ['stage']);
  assert.deepEqual(JSON.parse(files['config/preferences.json']).disqualifying_languages, ['german']);
  assert.equal(JSON.parse(files['config/preferences.json']).daily_applications_target, 5, 'the rest of the file is kept');
  assert.ok(ran.some(line => line.includes('render')), 'the settings page is published');
});
