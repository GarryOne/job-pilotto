// Strategy → Job preferences (pages/job-preferences.js, renderer/preferences-model.js; owner, 17 Oct 2026): must-haves / deal-breakers apart from
// the preferences that rank, each side's rules folded under a summary, "Add a deal-breaker" / "Add a preference" writing where the side reads them
// back. The class: every Preferences field is drawn on one side or names the screen that edits it, so none is lost when the Profile tab goes.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from './tiny-dom.js';
import {FIELDS, SIDES, readProfile, summaryOf} from '../renderer/preferences-model.js';
import {GOAL_ROWS} from '../renderer/markdown-edit.js';
import {DETAILS_HEADINGS} from '../renderer/details-headings.js';
import {HEADING} from '../lib/contact.js';
import {SECTIONS} from '../lib/profile-sections.js';

const body = install();
const row = (id, ...cells) => ({id, type: 'table_row', cells});
const TEMPLATE = [
  {id: 'h1', type: 'heading_1', text: 'Hard constraints'},
  {id: 'i1', type: 'paragraph', text: 'Jobs that break these are filtered out before any AI scoring.'},
  {id: 't1', type: 'table', header: true, rows: [row('c0', 'Constraint', 'Value'), row('c1', 'Countries', 'Switzerland'), row('c2', 'Recruiter listings', 'exclude')]},
  {id: 'h2', type: 'heading_1', text: 'Preferences (soft, used for ranking)'},
  {id: 't2', type: 'table', header: true, rows: [row('s0', 'Preference', 'Value'), row('s1', 'On-call', 'No on-call'), row('s2', 'Role types, most wanted first', 'SRE')]},
  {id: 'h3', type: 'heading_1', text: 'Summary (from CV)'}, {id: 'l3', type: 'paragraph', text: 'Engineer with 8 years of AWS.'},
];
const DEAL_BREAKERS = [{id: 'h4', type: 'heading_2', text: 'Deal-breakers'}, {id: 'd1', type: 'bulleted_list_item', text: 'Roles that require fluent German'}];

test('a row\'s side is its section\'s; a sentence is a rule only under Deal-breakers; the summary leaves out the label "Add" writes', () => {
  const read = readProfile([...TEMPLATE, ...DEAL_BREAKERS]);
  assert.deepEqual(read.other.map(item => [item.label || item.value, item.side]), [['Recruiter listings', 'must'], ['On-call', 'rank'], ['Roles that require fluent German', 'must']]);
  assert.ok(read.rest.some(item => item.text === 'Jobs that break these are filtered out before any AI scoring.'), 'the template\'s explanation is no rule');
  assert.deepEqual(read.ends, {must: 'd1', rank: 't2', rules: 'd1'});
  assert.equal(read.fields.roles.id, 's2', 'a known field is still found in any section');
  assert.equal(summaryOf([{label: 'Deal-breaker', value: 'No on-call'}, {label: 'Industries', value: 'No gambling'}, {label: '', value: 'Travel under 20%'}]),
    'No on-call · Industries: No gambling · 1 more');
});

test('every Preferences field is drawn on a side or edited elsewhere: Goals edits the ones it names', () => {
  for (const field of FIELDS) {
    if (field.side) { assert.ok(SIDES[field.side], field.key); continue; }
    assert.ok(['goals', 'details'].includes(field.editedIn), `${field.key}: no side and no home`);
  }
  // The Profile template's own labels for what Goals edits (docs/notion-profile-template.md).
  for (const label of ['Work mode', 'Minimum seniority', 'Minimum acceptable']) {
    const field = FIELDS.find(each => each.match.test(label));
    assert.equal(field.editedIn, 'goals', label);
    assert.ok(Object.values(GOAL_ROWS).some(goal => goal.match.test(label)), `Goals edits ${label}`);
  }
});

async function open(items, sent = []) {
  globalThis.window.pilot = new Proxy({textOutline: async () => ({ok: true, items, store: 'Notion'}),
    textEdit: async (name, changes) => { sent.push([name, changes]); return {ok: true, items}; }}, {get: (all, key) => all[key] || (() => null)});
  const node = globalThis.document.createElement('div');
  node.id = 'preferences-body';
  body.replaceChildren(node);
  await (await import('../renderer/pages/job-preferences.js')).loadPreferences();
  return node;
}
const sideOf = (node, key) => node.querySelectorAll('.pref-section').find(each => each.dataset.side === key);
async function add(items, key, text) {
  const sent = [];
  const node = await open(items, sent);
  const field = sideOf(node, key).querySelectorAll('input').find(input => input.ariaLabel === SIDES[key].add);
  field.value = text;
  field.dispatch('input');
  await node.querySelector('#outline-save-preferences').listeners.click[0]();
  return sent[0][1];
}

test('the card: two sides in order, work mode / seniority / minimum not repeated from Goals', async () => {
  const node = await open([...TEMPLATE, {id: 'm1', type: 'paragraph', text: 'Minimum acceptable: CHF 120k'}]);
  assert.deepEqual(node.querySelectorAll('.pref-section').map(each => each.dataset.side), ['must', 'rank']);
  assert.equal(node.querySelectorAll('.pref-modes').length, 0);
  assert.ok(!node.textContent.includes('CHF 120k'));
  assert.match(sideOf(node, 'must').textContent, /Recruiter listings/);
  assert.match(sideOf(node, 'rank').textContent, /On-call/);
});

test('"Add a deal-breaker" writes a sentence under Deal-breakers, else a labelled line after Hard constraints; "Add a preference" after Preferences', async () => {
  assert.deepEqual(await add([...TEMPLATE, ...DEAL_BREAKERS], 'must', 'No on-call'), [{op: 'insert', after: 'd1', key: 'add-must', lines: ['No on-call']}]);
  assert.deepEqual(await add(TEMPLATE, 'must', 'No on-call'), [{op: 'insert', after: 't1', key: 'add-must', lines: ['Deal-breaker: No on-call']}]);
  assert.deepEqual(await add(TEMPLATE, 'rank', 'Remote-first teams'), [{op: 'insert', after: 't2', key: 'add-rank', lines: ['Preference: Remote-first teams']}]);
  // Read back: each lands on its own side.
  const back = readProfile([...TEMPLATE.slice(0, 3), {id: 'n1', type: 'paragraph', text: 'Deal-breaker: No on-call'}, ...TEMPLATE.slice(3, 5), {id: 'n2', type: 'paragraph', text: 'Preference: Remote-first teams'}]);
  assert.deepEqual(back.other.filter(item => /Deal-breaker|Preference/.test(item.label)).map(item => item.side), ['must', 'rank']);
});

test('the AI review offers only the fields the card draws, even when it read work mode, seniority and languages', async () => {
  const parse = {countries: ['CH', 'DE'], cities: [], remote: 'yes', languages: [{name: 'English', level: 'Fluent'}], relocation: {answer: 'unknown', where: ''}, roles: [],
    seniority: {min: 'senior', max: 'senior', open_ended: false}, employment: [], notes: [], unparsed: ['countries', 'mode', 'languages', 'seniority']};
  globalThis.window.pilot = new Proxy({textOutline: async () => ({ok: true, items: TEMPLATE, store: 'Notion'}), preferencesParse: async () => ({parse, key: 'k-drawn'})},
    {get: (all, key) => all[key] || (() => null)});
  const node = globalThis.document.createElement('div');
  node.id = 'preferences-body';
  body.replaceChildren(node);
  await (await import('../renderer/pages/job-preferences.js')).loadPreferences();
  await new Promise(resolve => setTimeout(resolve, 10));
  const rows = node.querySelectorAll('.pref-review-row').map(each => each.dataset.field);
  assert.ok(rows.length >= 1, 'the card is drawn');
  for (const key of rows) assert.ok(FIELDS.find(field => field.key === key)?.side, `${key} is drawn here`);
});

test('no section for a side: no Add field (nothing written where it would not read back)', async () => {
  const node = await open([{id: 'h', type: 'heading_1', text: 'Summary (from CV)'}, {id: 'l', type: 'paragraph', text: 'Engineer.'}]);
  assert.equal(node.querySelectorAll('input').filter(input => input.ariaLabel === SIDES.must.add || input.ariaLabel === SIDES.rank.add).length, 0);
});

test('the window\'s list of Your details\' headings is the main process\'s', () => {
  assert.deepEqual(DETAILS_HEADINGS, [HEADING, ...Object.values(SECTIONS)]);
});

test('⌘K reaches the card and its Review button on Strategy (the Settings scan no longer sees them)', async () => {
  const fs = await import('node:fs');
  const nav = fs.readFileSync(new URL('../renderer/pages/nav.js', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
  assert.match(nav, /add\('Strategy', 'Job preferences'[\s\S]{0,300}\$\('strategy-job-prefs'\)/);
  assert.match(nav, /button\('strategy', 'preferences-review'/);
  const strategy = html.slice(html.indexOf('id="strategy-yours"'), html.indexOf('id="strategy-suggestions"'));
  for (const id of ['strategy-job-prefs', 'preferences-review', 'preferences-body']) assert.match(strategy, new RegExp(`id="${id}"`), id);
});
