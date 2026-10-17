// The move into Your details also clears a "❓" copy of a fact Your details answers (owner's Profile, 18 Oct 2026: the Preferences row "Start date /
// notice period: ❓ to confirm" stayed while 💶 said "1 month's notice"; a ❓ reads as "ask the user"). A ❓ whose fact has no answer anywhere stays (it is
// still the ask); no value is lost; on every store. Fictional values; the AI is a fake giving the fixed answer by what each line says.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import * as store from '../lib/store/index.js';
import {move} from '../lib/profile-move.js';
import {fakeNotion} from './fake-notion.js';

const PROFILE = ['## 💶 Availability & compensation', 'Notice period / earliest start: 1 month',
  '## Preferences', {table: [['Preference', 'Value'], ['Start date / notice period', '❓ to confirm'], ['On-call', 'Yes'], ['Salary expectation', '❓']]}];
const ANSWERS = ['## Availability', 'Earliest start date: ❓', '## Other', 'Willing to relocate: ❓', 'Pronouns: He/him'];
const markdown = lines => lines.map(line => (typeof line === 'object' ? line.table.map((cells, i) => `| ${cells.join(' | ')} |${i === 0 ? '\n|---|---|' : ''}`).join('\n')
  : line.startsWith('## ') ? line : `- ${line}`)).join('\n') + '\n';

const RULES = [[/notice period|earliest start|start date/i, 'availability', 'notice period'], [/Salary expectation/, 'availability', 'salary expectation']];
const ai = (calls = []) => ({client: {messages: {create: async request => {
  const items = JSON.parse(request.messages[0].content);
  calls.push(items);
  return {content: [{type: 'text', text: JSON.stringify({items: items.map(({id, line}) => {
    const rule = RULES.find(([pattern]) => pattern.test(line));
    return rule ? {id, home: rule[1], topic: rule[2]} : {id, home: 'stay', topic: 'other'};
  })})}]};
}}}});

const fresh = settings => { const s = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-move-open-')), {encrypt: v => v, decrypt: v => v}); s.saveSettings(settings); return s; };
const ADAPTERS = {
  sqlite: async () => {
    const storage = fresh({store: 'sqlite'});
    const opened = store.openStore(storage);
    await opened.page('profile').write(markdown(PROFILE));
    await opened.page('answers').write(markdown(ANSWERS));
    return {storage, fetcher: undefined};
  },
  notion: async () => {
    const pages = {profile: fakeNotion(PROFILE, {prefix: 'P'}), answers: fakeNotion(ANSWERS, {prefix: 'A'})};
    const fetcher = (url, init) => {
      const route = url.replace('https://api.notion.com/v1/', '');
      return (route.startsWith('blocks/profile') || route.startsWith('blocks/P') ? pages.profile : pages.answers).fetcher(url, init);
    };
    const storage = fresh({store: 'notion', notionIds: {NOTION_PROFILE_PAGE_ID: 'profile', NOTION_ANSWERS_PAGE_ID: 'answers'}});
    storage.setSecret('NOTION_TOKEN', 'secret');
    return {storage, fetcher};
  },
};
const both = async (storage, fetcher) => (await Promise.all(['profile', 'answers'].map(name => store.openStore(storage, {fetcher}).page(name).text()))).join('\n');

for (const [name, make] of Object.entries(ADAPTERS)) {
  test(`${name}: a ❓ copy of a fact Your details answers goes; a ❓ with no answer stays; nothing is lost`, async () => {
    const {storage, fetcher} = await make();
    const calls = [];
    const result = await move(storage, {fetcher, ai: ai(calls), copy: async () => ({dir: 'copy-dir', file: 'backup.tar.gz'})});
    const after = await both(storage, fetcher);
    assert.doesNotMatch(after, /Start date \/ notice period/, 'the Preferences ❓ row of an answered fact');
    assert.doesNotMatch(after, /Earliest start date/, 'the answers page ❓ line of an answered fact');
    assert.match(after, /Notice period \/ earliest start: 1 month/, 'the answer itself');
    assert.match(after, /Salary expectation/, 'a ❓ whose fact has no answer: still the ask');
    assert.match(after, /Willing to relocate: ❓/);
    for (const value of ['On-call', 'Pronouns: He/him']) assert.match(after, new RegExp(value), value);
    assert.equal(result.cleared, 2);
    assert.ok(calls[0].some(item => /Notice period \/ earliest start/.test(item.line)), 'Your details lines are judged too, for their topic');
  });
}

test('nothing to move and no ❓ copy: no copy, no change', async () => {
  const {storage, fetcher} = await ADAPTERS.sqlite();
  const opened = store.openStore(storage);
  await opened.page('profile').write(markdown(['## 💶 Availability & compensation', 'Notice period / earliest start: 1 month']));
  await opened.page('answers').write(markdown(['## Other', 'Willing to relocate: ❓']));
  let copied = 0;
  const result = await move(storage, {fetcher, ai: ai(), copy: async () => { copied++; return {dir: 'd', file: 'f'}; }});
  assert.equal(result.moved, 0);
  assert.equal(copied, 0);
});
