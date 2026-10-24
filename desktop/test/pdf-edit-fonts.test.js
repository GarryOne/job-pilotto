// lib/pdf-edit/fonts.js + cv-inplace's tailorInPlace: letters the CV's embedded subset lacks come from the same face installed, else the
// same free font downloaded once, else a same-width twin; with none of them the item keeps its wording. No network here: fetch is a stub.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {applyTailoring} from '../lib/cv.js';
import {tailorInPlace} from '../lib/cv-inplace.js';
import {familyOf, findFont} from '../lib/pdf-edit/fonts.js';
import {writePdf} from '../lib/pdf-edit/write.js';
import {prints, read} from './pdf-fidelity.js';

const here = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'cv-shapes');
const liberation = path.join(path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')), 'standard_fonts', 'LiberationSans-Regular.ttf');
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jp-fonts-'));
// A stub of Google Fonts: CSS for the families it has, then the file.
const fontsSite = families => async url => {
  const family = decodeURIComponent(new URL(url).searchParams.get('family') || '').split(':')[0];
  if (url.startsWith('https://fonts.googleapis.com/')) return families.includes(family)
    ? {ok: true, text: async () => `@font-face { src: url(https://fonts.gstatic.com/s/${encodeURIComponent(family)}.ttf) format('truetype'); }`} : {ok: false, text: async () => ''};
  return {ok: true, arrayBuffer: async () => fs.readFileSync(liberation)};
};

test('a PDF font name reads as family, weight and slant', () => {
  assert.deepEqual(familyOf('ABCDEF+TimesNewRomanPS-BoldItalicMT'), {family: 'Times New Roman', weight: 700, italic: true});
  assert.deepEqual(familyOf('Calibri'), {family: 'Calibri', weight: 400, italic: false});
  assert.deepEqual(familyOf('Inter-Regular_SemiBold'), {family: 'Inter', weight: 600, italic: false});
  assert.deepEqual(familyOf('ArialMT'), {family: 'Arial', weight: 400, italic: false});
});

test('the chain: installed first, then the same family downloaded once, then the twin, else nothing', async () => {
  const fonts = temp(), cache = temp();
  fs.copyFileSync(liberation, path.join(fonts, 'LiberationSans-Regular.ttf'));
  const installed = await findFont('ABCDEF+LiberationSans', 'zq', {dirs: [fonts], cacheDir: cache, fetchImpl: () => { throw new Error('no network'); }});
  assert.equal(installed.from, 'installed');
  assert.ok(installed.glyphs.z.width > 0);
  const downloaded = await findFont('Manrope-Bold', 'z', {dirs: [], cacheDir: cache, fetchImpl: fontsSite(['Manrope'])});
  assert.equal(downloaded.from, 'download');
  assert.ok(fs.existsSync(path.join(cache, 'manrope-700.ttf')), 'kept for next time');
  const again = await findFont('Manrope-Bold', 'z', {dirs: [], cacheDir: cache, fetchImpl: () => { throw new Error('downloaded twice'); }});
  assert.equal(again.from, 'download');
  const twin = await findFont('Calibri', 'z', {dirs: [], cacheDir: cache, fetchImpl: fontsSite(['Carlito'])});
  assert.equal(twin.from, 'twin');
  assert.equal(await findFont('SomePrivateFace', 'z', {dirs: [], cacheDir: cache, fetchImpl: fontsSite([])}), null);
});

test('a tailored word with a letter the subset lacks: printed from the fallback font, or the item keeps its wording', async () => {
  const {cv, tailoring} = JSON.parse(fs.readFileSync(path.join(here, 'shapes.json'), 'utf8')).band;
  const bytes = fs.readFileSync(path.join(here, 'band.pdf'));
  const asked = structuredClone(tailoring);
  asked.jobs[2].roles[0].bullets = cv.jobs[2].roles[0].bullets.map((text, source) => ({source, text}));
  asked.jobs[2].roles[0].bullets[0].text = 'Organized websites and brand material for small Nordic firms.';   // "z" is not in the subset
  const {review} = applyTailoring(cv, asked);

  const none = await tailorInPlace(await read(bytes), cv, review, {dirs: [], cacheDir: temp(), fetchImpl: fontsSite([])});
  assert.ok(none.warnings.some(w => /Studio Fjord.*has no "\w*z\w*"/.test(w)), none.warnings.join('\n'));

  const doc = await read(bytes);
  const got = await tailorInPlace(doc, cv, review, {dirs: [], cacheDir: temp(), fetchImpl: fontsSite(['Carlito'])});
  assert.deepEqual(got.found.map(f => f.from), ['download']);
  assert.ok(!got.warnings.some(w => /has no/.test(w)), got.warnings.join('\n'));
  const after = await read(await writePdf(bytes, doc, got.plan, {embeds: got.embeds}));
  assert.ok(prints(after, 'Organized websites and brand material for small Nordic firms.'));
  assert.equal(after.pages.length, 1);
});
