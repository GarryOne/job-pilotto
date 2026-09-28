// Notion is the source of truth: contact details, form knowledge and open questions live there, and what an
// older version left on the Mac moves to Notion once (then the Mac copy is gone).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as contact from '../lib/contact.js';
import * as knowledge from '../lib/knowledge.js';
import * as migrate from '../lib/migrate.js';
import {createStorage} from '../lib/storage.js';
import {fakeNotion} from './fake-notion.js';

const fakeCrypto = {encrypt: v => Buffer.from(v).toString('base64'), decrypt: s => Buffer.from(s, 'base64').toString()};
const connected = (ids = {}) => {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-')), fakeCrypto);
  storage.setSecret('NOTION_TOKEN', 'ntn_x');
  storage.saveSettings({setupDone: true, notionIds: {NOTION_PROFILE_PAGE_ID: 'profile', NOTION_ANSWERS_PAGE_ID: 'answers', ...ids}});
  return storage;
};

test('contact details are a section of the Notion Profile; saving rewrites only that section', async () => {
  const storage = connected();
  const {fetcher, texts} = fakeNotion(['## Summary', 'SRE, 10 years', '## 📇 Contact details', 'Email: old@x.com', 'Phone: +41 1', '## Preferences', 'Zurich']);
  assert.deepEqual(await contact.read(storage, fetcher), {email: 'old@x.com', phone: '+41 1'});
  await contact.save(storage, {first_name: 'Igor', email: 'igor@x.com', bogus: 'x'}, fetcher);
  assert.deepEqual(texts(), ['## Summary', 'SRE, 10 years', '## 📇 Contact details', 'First name: Igor', 'Email: igor@x.com', '## Preferences', 'Zurich']);
  assert.equal(storage.settings().contact, undefined);
  // No section yet: it's added at the end.
  const empty = fakeNotion(['## Summary']);
  await contact.save(storage, {email: 'a@b.c'}, empty.fetcher);
  assert.deepEqual(empty.texts(), ['## Summary', '## 📇 Contact details', 'Email: a@b.c']);
});

test('form knowledge lives on its Notion page: a newer note replaces its line, the rest are appended', async () => {
  const storage = connected({NOTION_KNOWLEDGE_PAGE: 'kp'});
  const {fetcher, texts} = fakeNotion(['What Job Pilotto learned…', '[any] Preferred First Name: Same as first name → "Igor"']);
  const [old] = await knowledge.notes(storage, fetcher);
  assert.deepEqual({...old, block: undefined}, {scope: 'any', kind: 'answer', field: 'Preferred First Name', note: 'Same as first name', value: 'Igor', block: undefined});
  await knowledge.add(storage, [
    {scope: 'any', kind: 'answer', field: 'Preferred First Name', note: 'Use the first name', value: 'Igor'},
    {scope: 'boards.greenhouse.io', kind: 'option', field: 'How did you hear about us?', note: 'Pick the careers site', value: 'Careers Website'}], fetcher);
  assert.deepEqual(texts().slice(1), ['[any · answer] Preferred First Name: Use the first name → "Igor"',
    '[boards.greenhouse.io · option] How did you hear about us?: Pick the careers site → "Careers Website"']);
  assert.equal(storage.settings().formKnowledge, undefined);
});

test('data an older version kept on the Mac moves to Notion once, then only Notion has it', async () => {
  const storage = connected({NOTION_KNOWLEDGE_PAGE: 'kp'});
  storage.saveSettings({
    openQuestions: [{key: 'visa sponsorship', question: 'Visa sponsorship', company: 'Acme'}], answeredQuestions: ['x'],
    formKnowledge: [{scope: 'any', kind: 'widget', field: 'City', note: 'Type, then pick the suggestion', value: ''}],
    contact: {email: 'igor@x.com', phone: '+41 1'},
  });
  const page = fakeNotion(['## 📇 Contact details', 'Email: notion@x.com']);  // one fake page stands in for all three
  // (profile copies and search settings have their own tests; they'd need the Python side here)
  const steps = migrate.STEPS.filter(s => !['workspace', 'profile copies', 'search settings'].includes(s.name));
  const moved = await migrate.run(storage, () => {}, steps, page.fetcher);
  assert.deepEqual(moved, ['open questions', 'form knowledge', 'contact details']);
  const texts = page.texts();
  assert.ok(texts.includes('Visa sponsorship: ❓ (asked by Acme)'));
  assert.ok(texts.includes('[any · widget] City: Type, then pick the suggestion'));
  assert.ok(texts.includes('Email: notion@x.com') && texts.includes('Phone: +41 1'));  // Notion's value won
  const settings = storage.settings();
  for (const key of ['openQuestions', 'answeredQuestions', 'formKnowledge', 'contact']) assert.equal(settings[key], undefined, key);
  assert.deepEqual(await migrate.run(storage, () => {}, steps, page.fetcher), []);  // nothing left
});

test('search settings become a readable Notion page next to the Profile, created once and rewritten after a rebuild', async () => {
  const {publishSearchSettings} = await import('../lib/strategy.js');
  const storage = connected();
  const calls = [];
  const deps = {
    run: async (_, args) => { calls.push(args.join(' ')); return {code: 0, stdout: '## Roles to look for\n- sre\n'}; },
    ensurePage: async (token, beside, title) => { calls.push(`create ${title} beside ${beside}`); return 'settings-page'; },
    writePage: async (token, page, markdown) => { calls.push(`write ${page}: ${markdown.trim().split('\n')[1]}`); },
  };
  assert.equal(await publishSearchSettings(storage, deps), 'settings-page');
  assert.equal(storage.settings().notionIds.NOTION_SEARCH_SETTINGS_PAGE, 'settings-page');
  await publishSearchSettings(storage, deps);  // exists now: only rewritten
  assert.deepEqual(calls, ['create ⚙️ Search settings beside profile', 'src.notion.search_settings render', 'write settings-page: - sre',
    'src.notion.search_settings render', 'write settings-page: - sre']);
});
