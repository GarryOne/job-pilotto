// page/upload.js keeps a plain-script copy of fileKind and the floor of extension/alias-schema.js (a content script cannot import a module):
// they must agree on every wording, with and without the service's phrases. Also the page rows: an upload slot is a file row named by its meaning.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { fileKind } from '../../extension/alias-schema.js';
import { loadJsdom, openPage } from './helpers/page.js';

const module = { exports: {} };
new Function('module', 'window', fs.readFileSync(new URL('../../extension/page/upload.js', import.meta.url), 'utf8'))(module, {});
const copy = module.exports;

const LABELS = ['CV', 'Upload your CV *', 'Resume/CV', 'Lebenslauf hochladen', 'Charger un CV', 'Curriculum vitae', 'Cover letter (optional)', 'Anschreiben',
  'Lettre de motivation, certificats', 'Lettera di presentazione', 'Carta de presentación', 'CV / cover letter', 'Add a document', 'Dossier principal', 'Fichier joint', '', '   ',
  'Please attach 2 files', 'Portfolio', 'Diplomas', 'Mein Lebenslauf (PDF)', 'Ajouter un document'];
const PACKS = [[], [{ key: 'resume', phrase: 'dossier principal' }, { key: 'cover_letter', phrase: 'fichier joint' }], [{ key: 'resume', phrase: 'cover letter' }]];

test('the plain-script copy in page/upload.js means the same as alias-schema.js for every wording', () => {
  for (const aliases of PACKS) for (const label of LABELS) assert.equal(copy.fileKind(label, aliases), fileKind(label, aliases), `${JSON.stringify(label)} with ${aliases.length} phrases`);
});

test('an upload slot is a file row named by its meaning, required by the page\'s star, filled once a file is in it', async () => {
  const JSDOM = await loadJsdom();
  if (!JSDOM) return;
  const { window } = openPage(JSDOM, '<div class="field"><label>* Lebenslauf <input type="file" id="a"></label></div><div class="field"><label>Zeugnisse <input type="file" id="b"></label></div><input id="e">');
  const rows = window.__jobPilottoUpload.rows();
  assert.deepEqual(JSON.parse(JSON.stringify(rows.map(row => [row.field, row.type, row.required, row.filled]))), [['resume', 'file', true, false], ['upload_2', 'file', false, false]]);
});
