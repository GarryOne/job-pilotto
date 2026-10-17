// Profile → Experience's Professional summary and Strengths (renderer/experience-profile-model.js): found under the template's and the draft's
// headings, edited line by line and written back on every store (lib/text-outline-handlers.js); a Profile without the section gets it at the end.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import * as store from '../lib/store/index.js';
import {applyEdits} from '../lib/text-outline-handlers.js';
import {PARTS, changesFor, previewOf, readParts} from '../renderer/experience-profile-model.js';
import {fakeNotion} from './fake-notion.js';

const plainCrypto = {encrypt: value => value, decrypt: value => value};
const fresh = settings => { const s = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-exp-')), plainCrypto); s.saveSettings(settings); return s; };
const PROFILE = ['## Hard constraints', 'Work mode: Hybrid', '## Summary (from CV)', 'SRE with 8 years on AWS.', '## Strengths', 'Kubernetes at scale', 'On-call leadership', '## Links', 'GitHub: x'];
const markdown = lines => lines.map(line => (line.startsWith('## ') ? line : `- ${line}`)).join('\n') + '\n';
const ADAPTERS = {
  sqlite: async lines => {
    const storage = fresh({store: 'sqlite'});
    const page = store.openStore(storage).page('profile');
    await page.write(markdown(lines));
    return page;
  },
  notion: async lines => {
    const fake = fakeNotion(lines, {prefix: 'P'});
    const storage = fresh({store: 'notion', notionIds: {NOTION_PROFILE_PAGE_ID: 'profile'}});
    storage.setSecret('NOTION_TOKEN', 'secret');
    return store.openStore(storage, {fetcher: fake.fetcher}).page('profile');
  },
};

for (const [name, open] of Object.entries(ADAPTERS)) {
  test(`${name}: reads summary and strengths; an edit, a removal and a new line land in their section, the rest untouched`, async () => {
    const page = await open(PROFILE);
    const parts = readParts(await page.outline());
    assert.deepEqual(parts.summary.lines.map(line => line.text), ['SRE with 8 years on AWS.']);
    assert.deepEqual(parts.strengths.lines.map(line => line.text), ['Kubernetes at scale', 'On-call leadership']);
    assert.equal(previewOf(parts.strengths), 'Kubernetes at scale · On-call leadership');
    const changes = changesFor('strengths', parts.strengths, ['Kubernetes at scale (EKS)', '', 'Observability']);
    assert.deepEqual(changes.map(change => change.op), ['text', 'remove', 'insert']);
    const {missing} = await applyEdits(page, await page.outline(), changes);
    assert.deepEqual(missing, []);
    const after = readParts(await page.outline());
    assert.deepEqual(after.strengths.lines.map(line => line.text), ['Kubernetes at scale (EKS)', 'Observability']);
    assert.deepEqual(after.summary.lines.map(line => line.text), ['SRE with 8 years on AWS.']);
    const text = await page.text();
    assert.match(text, /Work mode: Hybrid/);
    assert.match(text, /GitHub: x/);
  });

  test(`${name}: a Profile with no summary gets the template's heading and the lines at the end`, async () => {
    const page = await open(['## Hard constraints', 'Work mode: Hybrid']);
    const parts = readParts(await page.outline());
    assert.equal(parts.summary, null);
    const changes = changesFor('summary', null, ['Platform engineer.', '']);
    assert.deepEqual(changes, [{op: 'section', heading: PARTS.summary.heading, lines: ['Platform engineer.']}]);
    await applyEdits(page, await page.outline(), changes);
    assert.deepEqual(readParts(await page.outline()).summary.lines.map(line => line.text), ['Platform engineer.']);
  });
}

test('the headings the template, the setup draft and a person use; nothing changed = no change', () => {
  for (const [heading, key] of [['Summary (from CV)', 'summary'], ['Professional summary', 'summary'], ['👤 About me', 'summary'], ['Core skills', 'strengths'], ['Strengths', 'strengths'], ['Expertise', 'strengths']]) {
    assert.ok(readParts([{id: 'h', type: 'heading_1', text: heading}, {id: 'l', type: 'paragraph', text: 'x'}])[key], heading);
  }
  assert.equal(readParts([{id: 'h', type: 'heading_1', text: 'Experience'}, {id: 'l', type: 'paragraph', text: 'x'}]).summary, null, 'the roles are not the summary');
  const part = {headingId: 'h', lines: [{id: 'a', text: 'Same'}]};
  assert.deepEqual(changesFor('summary', part, ['Same']), []);
  assert.deepEqual(changesFor('summary', null, ['', ' ']), []);
});

// The template's shape (docs/notion-profile-template.md), as a Notion outline: every section lands on the tab its meaning belongs to.
const row = (id, ...cells) => ({id, type: 'table_row', cells});
const TEMPLATE = [
  {id: 'i0', type: 'paragraph', text: 'The AI scorer (stage 2) reads this page at every run to judge how well each job fits.'},
  {id: 'h1', type: 'heading_1', text: 'Hard constraints'}, {id: 'i1', type: 'paragraph', text: 'Jobs that break these are filtered out before any AI scoring.'},
  {id: 't1', type: 'table', header: true, rows: [row('c0', 'Constraint', 'Value'), row('c1', 'Countries', 'Switzerland'), row('c2', 'Recruiter listings', 'exclude')]},
  {id: 'h2', type: 'heading_1', text: 'Application form answers — voluntary demographic surveys'},
  {id: 'i2', type: 'paragraph', text: 'Optional. Only fill this in if you want a standing answer for equal-opportunity survey questions'},
  {id: 'g1', type: 'bulleted_list_item', text: 'Gender: Decline to self-identify'},
  {id: 'h3', type: 'heading_1', text: 'Education'},
  {id: 't3', type: 'table', header: true, rows: [row('e0', 'School', 'Degree', 'Discipline'), row('e1', 'ETH Zurich', 'MSc', 'Computer Science'), row('e2', '❓', '❓', '❓')]},
  {id: 'h4', type: 'heading_1', text: 'Summary (from CV)'}, {id: 's1', type: 'paragraph', text: '❓ A few sentences describing your experience and focus, from your CV.'},
  {id: 'h5', type: 'heading_1', text: 'Experience'}, {id: 'r1', type: 'bulleted_list_item', text: 'SRE, Acme, 2019–2024'},
  {id: 'h6', type: 'heading_1', text: 'Targets'}, {id: 'x1', type: 'bulleted_list_item', text: 'Work mode: Hybrid'}, {id: 'x2', type: 'bulleted_list_item', text: 'Open to startups'},
  {id: 'h7', type: 'heading_1', text: 'Links'}, {id: 'k1', type: 'bulleted_list_item', text: 'GitHub: x'},
  {id: 'h8', type: 'heading_2', text: '💶 Availability & compensation'}, {id: 'a1', type: 'bulleted_list_item', text: 'Notice period: 2 months'},
];

test('each section on its tab; what Strategy or Your details edits, and the template\'s explanations, nowhere', async () => {
  const {partsOn, profileParts} = await import('../renderer/experience-profile-model.js');
  const parts = profileParts(TEMPLATE);
  const shown = tab => partsOn(parts, tab).map(each => [each.title, previewOf(each.part)]);
  assert.deepEqual(shown('experience'), [['Professional summary', ''], ['Strengths', ''], ['Education', 'ETH Zurich, MSc, Computer Science'],
    ['Targets', 'Open to startups']]);
  assert.deepEqual(parts.roles.lines.map(line => line.text), ['SRE, Acme, 2019–2024'], 'the role history is read; the job cards draw it');
  assert.deepEqual(shown('details'), [['Voluntary surveys', 'Gender: Decline to self-identify']]);
  const all = JSON.stringify(parts);
  for (const elsewhere of ['Recruiter listings', 'Hybrid', 'GitHub', '2 months', 'The AI scorer', 'Jobs that break', 'Optional. Only']) assert.ok(!all.includes(elsewhere), elsewhere);
});

test('the template\'s ❓ line becomes the first line; a table cell edit writes only that cell', () => {
  const parts = readParts(TEMPLATE);
  assert.deepEqual(changesFor('summary', parts.summary, ['Platform engineer.', 'Kubernetes at scale.']),
    [{op: 'text', id: 's1', value: 'Platform engineer.', was: '❓ A few sentences describing your experience and focus, from your CV.'}, {op: 'insert', after: 's1', lines: ['Kubernetes at scale.']}]);
  assert.deepEqual(changesFor('education', parts.education, [], [['ETH Zurich', 'MSc', 'Computer Engineering']]),
    [{op: 'cell', id: 'e1', index: 2, value: 'Computer Engineering', was: 'Computer Science'}]);
});

test('the class: every heading of the Profile template has a home (a Profile tab part, Strategy, or Your details)', async () => {
  const {kindOf} = await import('../renderer/profile-model.js');
  const fs = await import('node:fs');
  const template = fs.readFileSync(new URL('../../docs/notion-profile-template.md', import.meta.url), 'utf8');
  const profile = template.slice(template.indexOf('## 👤 Profile'), template.indexOf('## 📝 Application Answers'));
  const headings = [...profile.matchAll(/^# (.+)$/gm)].map(match => match[1].trim());
  assert.ok(headings.length >= 8, headings.join());
  const homeless = headings.filter(heading => !kindOf(heading) && !Object.values(PARTS).some(part => part.match.test(heading)) && !/^links$/i.test(heading));
  assert.deepEqual(homeless, [], 'a template section with no screen');
});
