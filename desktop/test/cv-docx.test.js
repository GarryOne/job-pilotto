// lib/cv-docx.js: a Word CV picked by the person is kept as cv.docx and drawn to cv.pdf (LibreOffice when there, else the app's renderer),
// LibreOffice is fetched in the background and the PDF drawn again with it without reading the CV again, and a PDF picked later leaves the
// .docx unused. Real setCv (no AI key: nothing is read by AI); the renderer and LibreOffice are stubs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as cvlib from '../lib/cv.js';
import {currentDocx, drawDocx, setDocxCv} from '../lib/cv-docx.js';
import * as atUpload from '../lib/cv-import-at-upload.js';

const word = path.join(import.meta.dirname, 'fixtures', 'cv-docx', 'classic.docx');
function storage() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-cv-docx-test-'));
  let settings = {};
  return {root, path: name => path.join(root, name), settings: () => settings, saveSettings: patch => { settings = {...settings, ...patch}; }};
}
const renderDocx = async () => ({pdf: Buffer.from('%PDF-1.7 drawn by the app')});
const convert = async () => Buffer.from('%PDF-1.7 drawn by LibreOffice');
const faces = async () => [];
const setCv = s => (from, as) => atUpload.setCv(s, from, as);
const office = (soffice = null, later = '/lo/soffice') => { const o = {started: 0, soffice: () => soffice, start: async () => { o.started++; return later; }}; return o; };

test('LibreOffice not here yet: the app draws the PDF, LibreOffice is fetched, the PDF drawn again; the CV is not read twice', async () => {
  const s = storage(), o = office();
  const set = await setDocxCv(s, word, 'Henrik_Aaltonen_CV.docx', {office: o, renderDocx, setCv: setCv(s), faces, convert});
  assert.equal(set.by, 'app');
  assert.equal(set.name, 'Henrik_Aaltonen_CV.docx');
  assert.equal(fs.readFileSync(s.path('cv.pdf'), 'utf8'), '%PDF-1.7 drawn by the app');
  assert.deepEqual(fs.readFileSync(currentDocx(s)), fs.readFileSync(word), 'the Word file is kept for Tailor');
  // The background read finished on the app's PDF:
  fs.writeFileSync(path.join(cvlib.dir(s), 'import.json'), JSON.stringify({pdf: cvlib.pdfHash(s)}));
  assert.equal(await set.redrawn, true);
  assert.equal(o.started, 1);
  assert.equal(fs.readFileSync(s.path('cv.pdf'), 'utf8'), '%PDF-1.7 drawn by LibreOffice');
  assert.ok(currentDocx(s), 'still the current CV after the redraw');
  assert.equal(cvlib.importedFrom(s), cvlib.pdfHash(s), 'the read mark moved to the new PDF: no second AI read');
});

test('LibreOffice already here: it draws the PDF at once, nothing fetched', async () => {
  const s = storage(), o = office('/lo/soffice');
  const set = await setDocxCv(s, word, 'cv.docx', {office: o, renderDocx, setCv: setCv(s), faces, convert});
  assert.equal(set.by, 'libreoffice');
  assert.equal(set.redrawn, undefined);
  assert.equal(o.started, 0);
  assert.equal(fs.readFileSync(s.path('cv.pdf'), 'utf8'), '%PDF-1.7 drawn by LibreOffice');
});

test('a PDF picked later: the old Word file no longer counts (and is not redrawn over the new PDF)', async () => {
  const s = storage();
  let release;
  const o = {soffice: () => null, start: () => new Promise(resolve => { release = resolve; })};
  const set = await setDocxCv(s, word, 'cv.docx', {office: o, renderDocx, setCv: setCv(s), faces, convert});
  const pdf = path.join(s.root, 'other.pdf');
  fs.writeFileSync(pdf, '%PDF-1.7 a PDF CV');
  atUpload.setCv(s, pdf, 'other.pdf');
  assert.equal(currentDocx(s), null);
  release('/lo/soffice');
  assert.equal(await set.redrawn, false);
  assert.equal(fs.readFileSync(s.path('cv.pdf'), 'utf8'), '%PDF-1.7 a PDF CV');
});

test('LibreOffice failing on a file: the app\'s renderer draws it', async () => {
  const drawn = await drawDocx(storage(), fs.readFileSync(word), {soffice: '/lo/soffice', renderDocx, faces, convert: async () => { throw new Error('made no PDF'); }});
  assert.equal(drawn.by, 'app');
});
