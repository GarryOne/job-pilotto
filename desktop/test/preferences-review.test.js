// Preferences: the "Review your preferences" card and the Workload rule, drawn from a Notion-shaped Profile (tiny DOM). Accept drafts the clean value plus an
// "Original wording" line into the one save bar and writes nothing until Save; Keep mine drafts nothing; Workload shows only for CH, DE or AT countries.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from './tiny-dom.js';
import {showWorkload} from '../renderer/preferences-review-model.js';

const body = install();
const row = (id, ...cells) => ({id, type: 'table_row', cells});
const profile = countries => [{id: 'p1', type: 'heading_1', text: 'Hard constraints'}, {id: 'p3', type: 'table', header: true, rows: [row('q0', 'Constraint', 'Value'),
  row('q1', 'Countries', countries), row('q2', 'Preferred cities', 'Most preferred: Zurich and surroundings. Abroad: Berlin'), row('q3', 'Work mode', 'Hybrid'), row('q4', 'Workload', '80–100%')]}];
const PARSE = {countries: ['CH', 'DE'], cities: [{name: 'Zurich', country: 'CH'}, {name: 'Berlin', country: 'DE'}], remote: 'unknown', languages: [], relocation: {answer: 'unknown', where: ''},
  roles: [], seniority: {min: 'unknown', max: 'unknown'}, employment: [],
  notes: [{field: 'cities', text: 'Anywhere else in Switzerland is fine'}, {field: 'countries', text: 'or remote roles'}], unparsed: ['countries', 'cities']};

let opened = 0;   // a new read has a new key (Keep mine is remembered per key)
async function open(items, parse, sent = [], asked = []) {
  globalThis.window.pilot = new Proxy({textOutline: async () => ({ok: true, items, store: 'Notion'}), preferencesParse: async request => { asked.push(request); return {parse, key: `k${++opened}`, fresh: true}; },
    textEdit: async (name, changes) => { sent.push([name, changes]); return {ok: true, items}; }}, {get: (all, key) => all[key] || (() => null)});
  const node = globalThis.document.createElement('div');
  node.id = 'preferences-body';
  body.replaceChildren(node);
  await (await import('../renderer/pages/preferences-tab.js')).loadPreferences();
  await new Promise(resolve => setTimeout(resolve, 10));
  return node;
}

test('the card shows what the AI flagged (old -> proposed); Accept drafts the value and the original wording, Save writes both', async () => {
  const sent = [], asked = [];
  const node = await open(profile('Switzerland (anywhere), plus Berlin, or remote roles'), PARSE, sent, asked);
  assert.equal(asked.length, 1);
  assert.match(asked[0].fields.cities, /Zurich and surroundings/, 'the AI is sent the typed text');
  const card = node.querySelector('#preferences-review-card');
  assert.ok(card, 'the review card is drawn');
  const lines = card.querySelectorAll('.pref-review-row');
  assert.deepEqual(lines.map(line => line.dataset.field), ['countries', 'cities']);
  assert.match(lines[0].textContent, /plus Berlin, or remote roles/);
  assert.match(lines[0].textContent, /Switzerland, Germany/);
  assert.equal(node.querySelector('.save-bar').hidden, true, 'nothing drafted yet');
  lines[0].querySelectorAll('button').find(button => button.textContent === 'Accept').click();
  assert.equal(node.querySelector('.save-bar').hidden, false);
  await node.querySelector('#outline-save-preferences').listeners.click[0]();
  const [[name, changes]] = sent;
  assert.equal(name, 'profile');
  assert.ok(changes.some(change => change.op === 'cell' && change.id === 'q1' && change.value === 'Switzerland, Germany'), JSON.stringify(changes));
  const notes = changes.filter(change => /^Original wording:/.test(change.lines?.[0] || ''));
  assert.deepEqual(notes.map(change => change.lines), [['Original wording: Countries — or remote roles']], 'ONE note line, only the phrase the clean value loses (never the whole old text)');
});

test('Keep mine drafts nothing and the card drops that field; no card when the AI flagged nothing or is unavailable', async () => {
  const sent = [];
  const node = await open(profile('Switzerland'), PARSE, sent);
  node.querySelector('.pref-review-row').querySelectorAll('button').find(button => button.textContent === 'Keep mine').click();
  assert.equal(node.querySelector('.save-bar').hidden, true);
  assert.equal(sent.length, 0);
  assert.deepEqual(node.querySelectorAll('.pref-review-row').map(line => line.dataset.field), ['cities'], 'countries kept as mine');
  const none = await open(profile('Switzerland, Germany'), {...PARSE, countries: ['CH', 'DE'], cities: [], unparsed: []});
  assert.equal(none.querySelector('#preferences-review-card'), null);
  const off = await open(profile('Switzerland (anywhere), or remote'), null);
  assert.equal(off.querySelector('#preferences-review-card'), null);
});

test('Workload stays in the Profile but is shown only when the countries include CH, DE or AT', async () => {
  const has = node => node.querySelectorAll('input[type="number"]').length > 0;
  assert.equal(has(await open(profile('Switzerland, France'), null)), true);
  assert.equal(has(await open(profile('Ireland, Spain'), null)), false, 'known countries, none of the three');
  assert.equal(has(await open(profile('Ireland, somewhere odd'), null)), true, 'unknown text: shown');
  assert.equal(has(await open(profile('Irland, Östereich'), {...PARSE, countries: ['IE', 'AT']})), true, 'names it cannot read: the AI\'s codes decide (Austria is in)');
  assert.equal(showWorkload('Austria (anywhere)'), true);
  assert.equal(showWorkload(''), true);
  assert.equal(showWorkload('Ireland'), false);
});

test('accepting a Languages proposal redraws the language rows from the clean value', async () => {
  const items = profile('Switzerland');
  items[1].rows.push(row('q5', 'Languages', 'English B2, Romanian native, Russian B1. No French'));
  const node = await open(items, {...PARSE, languages: [{name: 'English', level: 'B2'}, {name: 'Romanian', level: 'native'}], unparsed: ['languages']});
  assert.equal(node.querySelectorAll('.pref-language').length, 3, 'chopped by commas before');
  node.querySelector('[data-field="languages"]').querySelectorAll('button').find(button => button.textContent === 'Accept').click();
  assert.equal(node.querySelectorAll('.pref-language').length, 2);
});

test('Accept all drafts ONE Original wording line holding only what the clean values lose, and it shows collapsed under Other preferences for any profile', async () => {
  const sent = [];
  const items = [{id: 'h', type: 'heading_1', text: 'Targets'}, {id: 'b1', type: 'bulleted_list_item', text: 'Countries: Switzerland (anywhere), plus Berlin, or remote roles'},
    {id: 'b2', type: 'bulleted_list_item', text: 'Preferred cities: Zurich. Anywhere else in Switzerland is fine.'}];   // "Targets" is no known section
  const node = await open(items, PARSE, sent);
  node.querySelector('#preferences-review-accept-all').click();
  await node.querySelector('#outline-save-preferences').listeners.click[0]();
  const notes = sent[0][1].filter(change => /^Original wording:/.test(change.lines?.[0] || ''));
  // In the AI's order:
  assert.deepEqual(notes.map(change => change.lines), [['Original wording: Preferred cities — Anywhere else in Switzerland is fine; Countries — or remote roles']]);
  // Read back: the saved line is Other preferences' own note, whatever section it was written in, drawn collapsed.
  const saved = [...items, {id: 'n1', type: 'bulleted_list_item', text: 'Original wording: Countries — or remote roles'}];
  const again = await open(saved, null);
  const box = again.querySelectorAll('details.pref-note');
  assert.equal(box.length, 1);
  assert.ok(!box[0].open, 'collapsed');
  let up = box[0]; while (up && !(up.className || '').includes('pref-section')) up = up.parentNode;
  assert.ok(up.textContent.startsWith('Other preferences') && !up.textContent.includes('The rest of your Profile'), 'under Other preferences, not The rest of your Profile');
});

test('a seniority range proposes "Senior to Staff or higher"; one level stays one level', async () => {
  const {proposedTexts} = await import('../renderer/preferences-review-model.js');
  assert.equal(proposedTexts({seniority: {min: 'senior', max: 'staff'}}).seniority, 'Senior to Staff or higher');
  assert.equal(proposedTexts({seniority: {min: 'senior', max: 'senior'}}).seniority, 'Senior');
  assert.equal(proposedTexts({seniority: {min: 'unknown', max: 'unknown'}}).seniority, '');
});
