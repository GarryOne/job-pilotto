// LinkedIn's data export (lib/linkedin-export.js, lib/zip-read.js) and its place in the experience bank (lib/experience.js addLinkedin).
// A real ZIP is built here (stored and deflated entries); the AI match is a fake.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {test} from 'node:test';
import * as cv from '../lib/cv.js';
import * as experience from '../lib/experience.js';
import {bulletsOf, parseCsv, readExport, toCv} from '../lib/linkedin-export.js';
import {listZip} from '../lib/zip-read.js';
import {createStorage} from '../lib/storage.js';

const POSITIONS = 'Company Name,Title,Description,Location,Started On,Finished On\n' +
  'Acme Inc.,"Site Reliability Engineer","Cut costs by 50%.\nBuilt Spark pipelines for 2 TB of logs, daily.",Zurich,Jan 2024,\n' +
  'Acme Inc.,Platform Engineer,Ran the platform.,Zurich,Jan 2022,Dec 2023\n' +
  'Gamma,Data Engineer,"Trained models.",Bern,Jan 2018,Dec 2019\n';
const PROFILE = '﻿First Name,Last Name,Headline,Summary,Geo Location\nAda,Example,SRE,"Reliability, mostly.","Zurich, Switzerland"\n';
const SKILLS = 'Name\nAWS\nPython\nSpark\n';

// A ZIP writer for the test: one stored entry, the rest deflated, with a central directory.
function zip(entries) {
  const locals = [], central = [];
  let offset = 0;
  entries.forEach(([name, text], i) => {
    const raw = Buffer.from(text), method = i === 0 ? 0 : 8, data = method ? zlib.deflateRawSync(raw) : raw, nameBuffer = Buffer.from(name);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(method, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameBuffer.length, 26);
    const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(method, 10); entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(raw.length, 24); entry.writeUInt16LE(nameBuffer.length, 28); entry.writeUInt32LE(offset, 42);
    locals.push(local, nameBuffer, data); central.push(entry, nameBuffer);
    offset += 30 + nameBuffer.length + data.length;
  });
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-li-'));
const writeZip = entries => { const file = path.join(tempDir(), 'export.zip'); fs.writeFileSync(file, zip(entries)); return file; };
const FILES = [['Basic_LinkedInDataExport/Positions.csv', POSITIONS], ['Basic_LinkedInDataExport/Profile.csv', PROFILE], ['Basic_LinkedInDataExport/Skills.csv', SKILLS], ['Other.csv', 'x\n1\n']];

test('CSV: quotes, commas, line breaks, BOM and notes above the header', () => {
  assert.deepEqual(parseCsv('a,b\n"x, y","line1\nline2"\r\n"q""uote",z'), [['a', 'b'], ['x, y', 'line1\nline2'], ['q"uote', 'z']]);
  assert.deepEqual(parseCsv(PROFILE)[0], ['First Name', 'Last Name', 'Headline', 'Summary', 'Geo Location']);
  assert.deepEqual(bulletsOf('• One\n- Two\n\nThree'), ['One', 'Two', 'Three']);
});

test('the export becomes a CV: roles of one employer together, periods, skills, profile', () => {
  const cvOf = toCv({'Positions.csv': 'Notes:\nsome note\n\n' + POSITIONS, 'Profile.csv': PROFILE, 'Skills.csv': SKILLS});
  assert.deepEqual(cvOf.jobs.map(j => [j.company, j.roles.map(r => [r.title, r.period])]),
    [['Acme Inc.', [['Site Reliability Engineer', 'Jan 2024 – Present'], ['Platform Engineer', 'Jan 2022 – Dec 2023']]], ['Gamma', [['Data Engineer', 'Jan 2018 – Dec 2019']]]]);
  assert.deepEqual(cvOf.jobs[0].roles[0].bullets, ['Cut costs by 50%.', 'Built Spark pipelines for 2 TB of logs, daily.']);
  assert.equal(cvOf.skills, 'AWS, Python, Spark');
  assert.equal(cvOf.name, 'Ada Example');
  assert.equal(cvOf.location, 'Zurich, Switzerland');
  assert.throws(() => toCv({'Profile.csv': PROFILE}), /No Positions\.csv/);
});

test('a ZIP is read by its central directory: stored and deflated entries, folders ignored', () => {
  const file = writeZip(FILES);
  assert.deepEqual(listZip(file).map(e => e.name), FILES.map(f => f[0]));
  assert.equal(readExport(file).jobs.length, 2);
  assert.throws(() => readExport(writeZip([['Profile.csv', PROFILE]])), /No Positions\.csv/);
  const notZip = path.join(tempDir(), 'x.zip'); fs.writeFileSync(notZip, 'nope');
  assert.throws(() => readExport(notZip), /not a ZIP/);
  assert.throws(() => readExport('cv.pdf'), /\.zip/);
});

const MAIN = {name: 'Ada Example', skills: 'AWS', jobs: [{company: 'Acme', roles: [{title: 'SRE', period: '2024 – Present', place: 'Zurich', bullets: ['Cut costs by **50%**.']}]}]};
const fakeClient = () => ({messages: {create: async () => ({stop_reason: 'end_turn', usage: {input_tokens: 1, output_tokens: 1},
  content: [{type: 'text', text: JSON.stringify({roles: [{source_role: 0, main_job: 0, main_role: 0, new_bullets: [1]}, {source_role: 1, main_job: -1, main_role: -1, new_bullets: []}, {source_role: 2, main_job: -1, main_role: -1, new_bullets: []}]})}]})}});

test('LinkedIn is one more source: matched with the main CV, replaced by a newer export, its skills known to tailoring', async () => {
  const s = createStorage(tempDir(), {encrypt: v => v, decrypt: v => v});
  await assert.rejects(experience.addLinkedin(s, writeZip(FILES), {client: fakeClient()}), /main CV first/);
  fs.mkdirSync(cv.dir(s), {recursive: true}); fs.writeFileSync(path.join(cv.dir(s), 'cv.json'), JSON.stringify(MAIN));
  const first = await experience.addLinkedin(s, writeZip(FILES), {client: fakeClient()});
  assert.equal(first.kind, 'linkedin');
  assert.equal(experience.list(s).length, 1);
  const second = await experience.addLinkedin(s, writeZip(FILES), {client: fakeClient()});
  assert.deepEqual(experience.list(s).map(x => x.id), [second.id], 'a newer export replaces the old one');
  const merged = experience.withExtras(s, MAIN);
  assert.deepEqual(merged.jobs[0].roles[0].bullets, ['Cut costs by **50%**.', 'Built Spark pipelines for 2 TB of logs, daily.']);
  assert.equal(merged.extraSkills, 'Python, Spark');
  assert.equal(experience.view(s).sources[0].kind, 'linkedin');
  assert.deepEqual(experience.view(s).sources[0].onlyHere.map(r => r.title), ['Platform Engineer', 'Data Engineer'], 'roles the main CV has no match for are listed, not added');
});
