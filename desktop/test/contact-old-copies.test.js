// Saving 📇 Contact details moves the lines it took from an older Profile's "Contact" and "Links" sections, never copies them (owner's Profile, 18 Oct
// 2026: Name, Email, Phone, LinkedIn and GitHub stood twice, once under "# Contact"/"# Links" and once in 📇). A line goes only when 📇 now holds the
// same value; a line with no contact field (Medium, Stack Overflow) or another value stays; an old heading left empty goes, one with sections under
// it stays. On every store (lib/store). Fictional values.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as contact from '../lib/contact.js';
import {createStorage} from '../lib/storage.js';
import {TEXT_FILES} from '../lib/store/text-files.js';
import {fakeNotion} from './fake-notion.js';

const OLD = ['# Summary', 'SRE, 10 years', '# Contact', 'Name: Alex Muster', 'Email: alex@example.com', 'Phone: +41 79 000 00 00',
  '# Links', 'LinkedIn: https://www.linkedin.com/in/alex', 'Medium: https://medium.com/@alex', '## Strengths', 'Kubernetes at scale'];
const fakeCrypto = {encrypt: v => Buffer.from(v).toString('base64'), decrypt: s => Buffer.from(s, 'base64').toString()};
const fresh = () => createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-contact-old-')), fakeCrypto);

const STORES = {
  sqlite: () => {
    const storage = fresh();
    storage.saveSettings({store: 'sqlite', telemetry: false});
    storage.writeText(TEXT_FILES.profile, `${OLD.map(line => (line.startsWith('#') ? line : `- ${line}`)).join('\n')}\n`);
    return {storage, fetcher: undefined, text: () => storage.readText(TEXT_FILES.profile)};
  },
  notion: () => {
    const storage = fresh();
    storage.setSecret('NOTION_TOKEN', 'ntn_x');
    storage.saveSettings({setupDone: true, notionIds: {NOTION_PROFILE_PAGE_ID: 'profile', NOTION_ANSWERS_PAGE_ID: 'answers'}});
    const {fetcher, texts} = fakeNotion(OLD);
    return {storage, fetcher, text: () => texts().join('\n')};
  },
};

for (const [name, open] of Object.entries(STORES)) {
  test(`${name}: the first save of 📇 moves the old Contact/Links lines, keeps what has no field`, async () => {
    const {storage, fetcher, text} = open();
    const found = await contact.read(storage, fetcher);
    assert.equal(found.email, 'alex@example.com', 'read from the old section while 📇 is missing');
    await contact.save(storage, {...found, phone: '+41 79 111 11 11'}, fetcher);
    const after = text();
    for (const value of ['alex@example.com', 'Alex Muster', 'https://www.linkedin.com/in/alex']) {
      assert.equal(after.split(value).length - 1, 1, `${value}: once, in 📇`);
    }
    assert.match(after, /Medium: https:\/\/medium\.com\/@alex/, 'no contact field: stays');
    assert.match(after, /Phone: \+41 79 000 00 00/, 'another value than the one saved: never lost');
    assert.match(after, /Phone: \+41 79 111 11 11/);
    assert.match(after, /Links/, 'a heading with a line left stays');
    assert.match(after, /Contact details/);
    assert.match(after, /Kubernetes at scale/);
    assert.deepEqual({...await contact.read(storage, fetcher)}, {...found, phone: '+41 79 111 11 11'});
  });

  test(`${name}: an old heading left empty goes; a later save finds nothing more to move`, async () => {
    const {storage, fetcher, text} = open();
    const found = await contact.read(storage, fetcher);
    await contact.save(storage, found, fetcher);
    const after = text();
    assert.doesNotMatch(after, /^#*\s*Contact\s*$/m, '"Contact" emptied: removed');
    assert.match(after, /Phone: \+41 79 000 00 00/, 'the phone, now in 📇');
    assert.equal(after.split('+41 79 000 00 00').length - 1, 1);
    await contact.save(storage, found, fetcher);
    assert.equal(text().split('alex@example.com').length - 1, 1, 'idempotent');
  });
}
