// lib/office.js: the LibreOffice add-on: which build each platform gets, where soffice is found (the app's copy before a system one),
// the download checked against its checksum (a mismatch installs nothing), unpacking on Mac and Windows, and a Word file to PDF.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {test} from 'node:test';
import {BUILDS, findOffice, installOffice, officePdf} from '../lib/office.js';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jp-office-test-'));
const body = Buffer.from('a pretend LibreOffice download');
const sha = crypto.createHash('sha256').update(body).digest('hex');
const fetcher = (hash = sha) => async url => url.endsWith('.sha256')
  ? {ok: true, text: async () => `${hash}  file\n`}
  : {ok: true, status: 200, headers: {get: () => String(body.length)}, body: Readable.from([body.subarray(0, 10), body.subarray(10)])};
// The unpack commands, done by hand: ditto copies the app out of the image, msiexec /a extracts program\soffice.exe.
const unpack = calls => async (cmd, args) => {
  calls.push(cmd);
  if (cmd === 'ditto') { fs.mkdirSync(path.join(args[1], 'Contents', 'MacOS'), {recursive: true}); fs.writeFileSync(path.join(args[1], 'Contents', 'MacOS', 'soffice'), ''); }
  if (cmd === 'msiexec') { const dir = args.find(a => a.startsWith('TARGETDIR=')).slice(10); fs.mkdirSync(path.join(dir, 'program'), {recursive: true}); fs.writeFileSync(path.join(dir, 'program', 'soffice.exe'), ''); }
  return {stdout: ''};
};

test('a build for Mac (Apple silicon, Intel) and Windows (x64, ARM), each pinned to one version', () => {
  assert.deepEqual(Object.keys(BUILDS).sort(), ['darwin-arm64', 'darwin-x64', 'win32-arm64', 'win32-x64']);
  for (const [key, file] of Object.entries(BUILDS)) assert.match(file, key.startsWith('darwin') ? /\.dmg$/ : /\.msi$/);
});

test('soffice: the app\'s own copy first, then one the person installed, else none', () => {
  // Paths as path.join builds them on the computer running the test (backslashes on Windows CI).
  const own = path.join('/data/office', 'LibreOffice.app', 'Contents', 'MacOS', 'soffice');
  const have = new Set([own, '/Applications/LibreOffice.app/Contents/MacOS/soffice']);
  assert.equal(findOffice('/data/office', {platform: 'darwin', exists: f => have.has(f)}), own);
  have.delete(own);
  assert.equal(findOffice('/data/office', {platform: 'darwin', exists: f => have.has(f)}), '/Applications/LibreOffice.app/Contents/MacOS/soffice');
  const win = path.join('C:\\Program Files', 'LibreOffice', 'program', 'soffice.exe');
  assert.equal(findOffice('/data/office', {platform: 'win32', env: {ProgramFiles: 'C:\\Program Files'}, exists: f => f === win}), win);
  assert.equal(findOffice('/data/office', {platform: 'win32', env: {}, exists: () => false}), null);
});

for (const key of ['darwin-arm64', 'win32-x64']) {
  test(`install on ${key}: downloaded, checked, unpacked into the app's folder`, async () => {
    const root = temp(), dir = path.join(root, 'office'), calls = [], steps = [];
    const soffice = await installOffice(dir, {key, fetchImpl: fetcher(), run: unpack(calls), onProgress: p => steps.push(p), work: root});
    assert.ok(fs.existsSync(soffice) && soffice.startsWith(dir), soffice);
    assert.deepEqual(calls, key.startsWith('darwin') ? ['hdiutil', 'ditto', 'hdiutil'] : ['msiexec']);
    const order = steps.map(p => p.step).filter((s, i, all) => s !== all[i - 1]);
    assert.deepEqual(order, ['download', 'check', 'unpack', 'ready'], 'each step is named, in order, for the progress bar');
    assert.deepEqual(steps.filter(p => p.step === 'download').map(p => p.bytes), [10, body.length]);
    assert.equal(steps.findLast(p => p.step === 'download').share, 1);
    assert.deepEqual(fs.readdirSync(root).sort(), ['office'], 'the download and the temporary folders are gone');
  });
}

test('a download that does not match its checksum installs nothing', async () => {
  const root = temp(), dir = path.join(root, 'office'), calls = [];
  await assert.rejects(installOffice(dir, {key: 'win32-x64', fetchImpl: fetcher('0'.repeat(64)), run: unpack(calls), work: root}), /did not match its checksum/);
  assert.deepEqual(calls, []);
  assert.ok(!fs.existsSync(dir));
});

test('a platform without a build says so (the app keeps its own renderer)', async () => {
  await assert.rejects(installOffice(path.join(temp(), 'office'), {key: 'linux-x64', fetchImpl: fetcher()}), /No LibreOffice build/);
});

test('a Word file to PDF: LibreOffice in its own profile, headless; no PDF made is an error', async () => {
  const root = temp();
  let args = null;
  const pdf = await officePdf('/x/soffice', Buffer.from('docx'), {profile: path.join(root, 'profile'), work: root,
    run: async (cmd, a) => { args = a; fs.writeFileSync(path.join(a[a.indexOf('--outdir') + 1], 'cv.pdf'), '%PDF-1.7'); }});
  assert.equal(pdf.toString(), '%PDF-1.7');
  assert.match(args[0], /^-env:UserInstallation=file:\/\//);
  assert.ok(args.includes('--headless') && args.includes('--convert-to'));
  await assert.rejects(officePdf('/x/soffice', Buffer.from('docx'), {profile: root, work: root, run: async () => {}}), /made no PDF/);
});
