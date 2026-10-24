// lib/docx/fonts.js: the fonts a Word CV names, and the faces the renderer loads for the ones this computer lacks (installed ones need none).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {facesFor, familiesOf} from '../lib/docx/fonts.js';
import {readDocx} from '../lib/docx/zip.js';

const here = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'cv-docx');

test('the families a Word CV uses: from its styles and its runs, symbol fonts left out', async () => {
  const {zip} = await readDocx(fs.readFileSync(path.join(here, 'classic.docx')));
  zip.file('word/document.xml', (await zip.file('word/document.xml').async('string')).replace('<w:body>', '<w:body><w:p><w:r><w:rPr><w:rFonts w:ascii="Wingdings" w:hAnsi="Wingdings"/></w:rPr><w:t>x</w:t></w:r></w:p>'));
  assert.deepEqual(await familiesOf(zip), ['Calibri']);
});

test('faces: none for an installed font, the four faces of a downloaded or twin one, nothing for one not found', async () => {
  const asked = [];
  const find = async name => { asked.push(name); return name.startsWith('Installed') ? {from: 'installed', bytes: Buffer.from('i')} : name.startsWith('Lost') ? null : {from: 'twin', bytes: Buffer.from(name)}; };
  const faces = await facesFor(['Installed Sans', 'Office Serif', 'Lost Font'], {find});
  assert.deepEqual(faces.map(f => [f.family, f.weight, f.style, Buffer.from(f.base64, 'base64').toString()]), [
    ['Office Serif', 400, 'normal', 'Office Serif'], ['Office Serif', 700, 'normal', 'Office Serif-Bold'],
    ['Office Serif', 400, 'italic', 'Office Serif-Italic'], ['Office Serif', 700, 'italic', 'Office Serif-BoldItalic']]);
  assert.deepEqual(asked.filter(n => n.startsWith('Installed')), ['Installed Sans'], 'an installed font is not looked up face by face');
});
