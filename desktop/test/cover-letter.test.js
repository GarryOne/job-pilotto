import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as letters from '../lib/cover-letter.js';
import {me} from '../lib/server.js';
import {createStorage} from '../lib/storage.js';

const fakeCrypto = {encrypt: v => v, decrypt: v => v};
const tempStorage = () => createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-letter-')), fakeCrypto);
const CV = {name: 'Ada Example', location: 'Zurich', summary: 'SRE.', jobs: [{company: 'Acme', roles: [{title: 'SRE', period: '2024 – Present', place: 'Zurich', bullets: ['Cut costs by **50%**.']}]}]};
const withCv = storage => { fs.mkdirSync(path.join(storage.path('cv')), {recursive: true}); fs.writeFileSync(storage.path('cv/cv.json'), JSON.stringify(CV)); return storage; };
const client = (letter, seen = []) => ({messages: {create: async request => { seen.push(request); return {stop_reason: 'end_turn', usage: {input_tokens: 1000, output_tokens: 300},
  content: [{type: 'text', text: JSON.stringify({letter})}]}; }}});

test('a generated letter is a draft, built from the CV, Profile and answers', async () => {
  const storage = withCv(tempStorage()), seen = [];
  const result = await letters.generate(storage, {client: client('Dear Hiring Team,\n\nI cut costs by 50%.', seen), profile: 'Prefers remote SRE roles', answers: 'Direct voice'});
  assert.match(result.text, /50%/);
  assert.deepEqual([letters.status(storage).state, letters.status(storage).pdf], ['draft', false]);
  const prompt = seen[0].messages[0].content;
  assert.match(prompt, /Cut costs/);
  assert.match(prompt, /Prefers remote SRE roles/);
  assert.match(prompt, /Direct voice/);
});

test('no CV data yet: generating says what to do first', async () => {
  await assert.rejects(letters.generate(tempStorage(), {client: client('x')}), /Read your CV first/);
});

test('approving keeps the PDF; editing the text makes it a draft again and drops the PDF', async () => {
  const storage = withCv(tempStorage());
  await letters.generate(storage, {client: client('Dear Hiring Team,\n\nHello.')});
  letters.approve(storage, Buffer.from('%PDF-letter'));
  assert.equal(letters.status(storage).state, 'approved');
  assert.equal(letters.status(storage).pdf, true);
  letters.edit(storage, 'Dear Hiring Team,\n\nHello.');  // unchanged text stays approved
  assert.equal(letters.status(storage).state, 'approved');
  letters.edit(storage, 'Dear Hiring Team,\n\nHello, changed.');
  assert.deepEqual([letters.status(storage).state, letters.status(storage).pdf], ['draft', false]);
  assert.throws(() => letters.edit(storage, '   '), /empty/);
});

test('the PDF page escapes the text and shows the sender', () => {
  const page = letters.html('Dear Team,\n\nI <3 uptime & more.', {first_name: 'Ada', last_name: 'Example', email: 'ada@example.test'});
  assert.match(page, /<h1>Ada Example<\/h1>/);
  assert.match(page, /ada@example\.test/);
  assert.match(page, /I &lt;3 uptime &amp; more\./);
  assert.equal((page.match(/<p>/g) || []).length, 2);
});

test('the extension gets the cover letter PDF only while a letter is approved', async () => {
  const storage = withCv(tempStorage());
  assert.equal((await me(storage)).coverLetterFile, null);
  await letters.generate(storage, {client: client('Dear Hiring Team,\n\nHello.')});
  assert.equal((await me(storage)).coverLetterFile, null);  // a draft is not uploaded
  letters.approve(storage, Buffer.from('%PDF-letter'));
  const file = (await me(storage)).coverLetterFile;
  assert.equal(file.type, 'application/pdf');
  assert.equal(Buffer.from(file.data, 'base64').toString(), '%PDF-letter');
});
