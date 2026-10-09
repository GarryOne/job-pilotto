// One copy (spec D2): with the data on this Mac, nothing is written to Notion, even when a Notion token and page ids are still set
// (someone who chose this Mac, or connected Notion before choosing). Each Notion writer the app runs by itself is listed here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as files from '../lib/files.js';
import {createStorage} from '../lib/storage.js';
import * as store from '../lib/store/index.js';
import * as contact from '../lib/contact.js';

function onThisMacWithNotionLeft() {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-one-')), {encrypt: v => v, decrypt: v => v});
  storage.setSecret('NOTION_TOKEN', 'ntn');
  storage.saveSettings({store: 'sqlite', notionIds: {NOTION_PROFILE_PAGE_ID: 'profile', NOTION_ANSWERS_PAGE_ID: 'answers', NOTION_AGENT_RUNS_DB: 'runs'}});
  fs.writeFileSync(storage.path('cv.pdf'), '%PDF-1.4');
  return storage;
}
const noNotion = async url => { throw new Error(`Notion was called: ${url}`); };

test('the CV and the cover letter are not uploaded to Notion when the store is this Mac', async () => {
  const storage = onThisMacWithNotionLeft();
  assert.deepEqual(await files.syncCv(storage, noNotion), {skipped: 'the data is on this Mac'});
  assert.equal(await files.coverLetterToProfile(storage, storage.path('cv.pdf'), noNotion), null);
});

test('contact details go to this Mac\'s profile.md, not the Notion Profile', async () => {
  const storage = onThisMacWithNotionLeft();
  assert.equal(store.openStore(storage).name, 'sqlite');
  await contact.save(storage, {email: 'a@b.c', phone: '1'}, noNotion);
  assert.match(storage.readText('profile.md'), /## 📇 Contact details\n- Email: a@b\.c\n- Phone: 1/);
  assert.deepEqual(await contact.read(storage, noNotion), {email: 'a@b.c', phone: '1'});
});

test('main.js writes session stats and conversations to Notion only when Notion is the store', () => {
  const source = fs.readFileSync(path.join(import.meta.dirname, '..', 'main.js'), 'utf8');
  assert.match(source, /db: notionGate\.notionInUse\(storage\) \? storage\.settings\(\)\.notionIds\?\.NOTION_AGENT_RUNS_DB : null/);
  assert.match(source, /!session\.transcript \|\| !notionGate\.notionInUse\(storage\)\) return;/);
});
