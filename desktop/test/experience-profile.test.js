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
