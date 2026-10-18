// Profile → Experience as folded cards (pages/experience-profile.js; owner, 17 Oct 2026: "It should be properly formatted. It should be collapsed, it
// should be using cards"; the roles "redundant. Just duplicating data" with the job cards; "Where your experience comes from" first). The shape is a
// real Profile's (fictional words): "Experience (full detail, …)" with a heading per role, a noted "Interests and strengths (…)", "Label:" strengths,
// a bracketed note with a ❓ under Education.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {install} from './tiny-dom.js';
import {groupsOf, partsOn, profileParts, splitNote} from '../renderer/experience-profile-model.js';

const body = install();
const row = (id, ...cells) => ({id, type: 'table_row', cells});
const PROFILE = [
  {id: 'h0', type: 'heading_1', text: 'Education'},
  {id: 't0', type: 'table', header: true, rows: [row('e0', 'School', 'Degree', 'Discipline'), row('e1', 'Example University', 'BSc', 'Physics')]},
  {id: 'n0', type: 'paragraph', text: '(confirmed 2 Sep 2026 — graduation year still ❓ to confirm if a form asks)'},
  {id: 'h1', type: 'heading_1', text: 'Summary (from CV, September 2026)'}, {id: 's1', type: 'paragraph', text: 'Platform engineer, 9 years on cloud systems.'},
  {id: 'h2', type: 'heading_1', text: 'Interests and strengths (in her own words, 1 Sep 2026)'},
  {id: 'i1', type: 'bulleted_list_item', text: '**Queues** are her main interest.'}, {id: 'i2', type: 'bulleted_list_item', text: 'Likes untangling legacy systems.'},
  {id: 'h3', type: 'heading_1', text: 'Core skills'},
  {id: 'k1', type: 'bulleted_list_item', text: '**Cloud:** GCP in depth (GKE, Pub/Sub); some AWS.'}, {id: 'k2', type: 'bulleted_list_item', text: '**IaC:** Pulumi, Terraform.'},
  {id: 'h4', type: 'heading_1', text: 'Experience (full detail, verbatim from CV, added 1 Sep 2026)'},
  {id: 'r1', type: 'heading_2', text: 'Staff Engineer — Northwind, Lyon, France · Jan 2024 – Present'}, {id: 'b1', type: 'bulleted_list_item', text: 'Ran the queue migration.'},
  {id: 'r2', type: 'heading_2', text: 'Engineer — Contoso, Remote · 2019 – 2023'}, {id: 'b2', type: 'bulleted_list_item', text: 'Built the billing pipeline.'},
  {id: 'h5', type: 'heading_1', text: 'Links'}, {id: 'l1', type: 'bulleted_list_item', text: 'GitHub: x'},
];

test('a heading\'s "(…)" is its note; roles under "Experience (…)" are the role history (not loose sections) and drawn by the job cards only', () => {
  assert.deepEqual(splitNote('Experience (full detail, added 1 Sep 2026)'), {title: 'Experience', note: 'full detail, added 1 Sep 2026'});
  const parts = profileParts(PROFILE);
  assert.deepEqual(parts.roles.lines.map(line => line.text), ['Ran the queue migration.', 'Built the billing pipeline.']);
  assert.equal(parts.roles.note, 'full detail, verbatim from CV, added 1 Sep 2026');
  assert.equal(parts.summary.note, 'from CV, September 2026');
  assert.deepEqual(partsOn(parts, 'experience').map(each => each.title), ['Professional summary', 'Strengths', 'Education', 'Interests and strengths']);
  assert.ok(!JSON.stringify(partsOn(parts, 'experience')).includes('Northwind'), 'no role on the Experience tab');
  const titled = profileParts([{id: 't', type: 'heading_1', text: 'Sam Lee — Engineer'}, {id: 'g', type: 'heading_2', text: 'Targets'}, {id: 'x', type: 'paragraph', text: 'Open to startups'}]);
  assert.deepEqual(titled.others.map(part => part.title), ['Targets'], 'under a page title, a sub-heading is its own section');
  assert.deepEqual(groupsOf(parts.strengths), [{label: 'Cloud', items: ['GCP in depth (GKE, Pub/Sub)', 'some AWS']}, {label: 'IaC', items: ['Pulumi', 'Terraform']}]);
});

async function open() {
  globalThis.window.pilot = new Proxy({textOutline: async () => ({ok: true, items: PROFILE, store: 'Notion'}), textEdit: async () => ({ok: true, items: PROFILE})},
    {get: (all, key) => all[key] || (() => null)});
  const node = globalThis.document.createElement('div');
  node.id = 'exp-profile';
  body.replaceChildren(node);
  await (await import('../renderer/pages/experience-profile.js')).loadExperienceProfile('experience');
  return node;
}

test('cards: summary and strengths open, the rest folded; strengths as label rows of chips; notes small, never a ❓; no role', async () => {
  const node = await open();
  const cards = node.querySelectorAll('details.qa-fold');
  assert.deepEqual(cards.map(card => [card.dataset.part, card.open]), [['summary', true], ['strengths', true], ['education', false], ['section:h2', false]]);
  const strengths = cards[1];
  assert.deepEqual(strengths.querySelectorAll('.exp-part-group').map(group => group.querySelector('b').textContent), ['Cloud', 'IaC']);
  assert.deepEqual(strengths.querySelectorAll('.chip-value').map(each => each.textContent), ['GCP in depth (GKE, Pub/Sub)', 'some AWS', 'Pulumi', 'Terraform']);
  assert.match(cards[2].textContent, /Example University, BSc, Physics/);
  assert.match(cards[2].querySelector('.small').textContent, /^confirmed 2 Sep 2026 — graduation year still to confirm/);
  assert.match(cards[3].textContent, /in her own words, 1 Sep 2026/);
  assert.ok(!node.textContent.includes('❓') && !node.textContent.includes('**') && !node.textContent.includes('Northwind'), node.textContent);
});

test('Edit opens Strengths as its groups: a name field and the values as chips (renderer/experience-editors.js)', async () => {
  const node = await open();
  const edit = node.querySelectorAll('button').find(button => button.getAttribute('aria-label') === 'Edit strengths');
  edit.listeners.click[0]({preventDefault() {}});
  const card = node.querySelectorAll('details.qa-fold').find(each => each.dataset.part === 'strengths');
  assert.deepEqual(card.querySelectorAll('input').filter(input => input.getAttribute('aria-label') === 'Group name').map(input => input.value), ['Cloud', 'IaC']);
  assert.deepEqual(card.querySelectorAll('.chip-value').map(each => each.textContent), ['GCP in depth (GKE, Pub/Sub)', 'some AWS', 'Pulumi', 'Terraform']);
  assert.equal(card.querySelectorAll('textarea').length, 0);
});

test('the tab opens with where the experience comes from, then Your background, then the job cards', () => {
  const html = fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
  const at = id => html.indexOf(`id="${id}"`);
  assert.ok(at('setting-experience-sources') > 0 && at('setting-experience-sources') < at('setting-experience-profile') && at('setting-experience-profile') < at('setting-experience-roles'));
});
