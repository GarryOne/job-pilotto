// lib/pdf-edit/: the content-stream lexer, finding a text on the page (emoji, ligatures, a hyphen drawn on its own), how a paragraph is
// measured (justified or ragged) and the writer's guards (a font used on another page, a file whose operators don't match pdf.js).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {lex} from '../lib/pdf-edit/lex.js';
import {copyShow, docText, findItem, measure} from '../lib/pdf-edit/layout.js';
import {writePdf} from '../lib/pdf-edit/write.js';
import {read} from './pdf-fidelity.js';

const here = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'cv-shapes');
const bytes = text => new TextEncoder().encode(text);

test('lexer: operators with their operands and exact byte ranges', () => {
  const src = 'BT /F1 9.5 Tf (a\\(b\\)\\101) Tj [<0041> -250 (c)] TJ 1 0 0 1 2 3 cm % note\nBI /W 1 ID xyz EI ET';
  const ops = lex(bytes(src));
  assert.deepEqual(ops.map(o => o.op), ['BT', 'Tf', 'Tj', 'TJ', 'cm', 'BI…EI', 'ET']);
  const tj = ops[2];
  assert.equal(String.fromCharCode(...tj.operands[0].str), 'a(b)A');
  assert.equal(src.slice(tj.start, tj.end), '(a\\(b\\)\\101) Tj');
  assert.equal(src.slice(ops[3].start, ops[3].end), '[<0041> -250 (c)] TJ');
  assert.deepEqual(ops[4].operands.map(o => o.num), [1, 0, 0, 1, 2, 3]);
});

// A made-up page: one show per glyph, like Chromium prints.
const page = (...words) => {
  const shows = []; let x = 10;
  for (const w of words) for (const u of w === ' ' ? [' '] : [...w]) { shows.push({font: 'f', size: 10, ps: 10, th: 1, tc: 0, fill: '#000000', rm: [10, 0, 0, 10, x, 0], x, y: 20, x1: x + 5, tx: 0.5, glyphs: [{u, code: 1, x, y: 20, w: 5, font: 'f', fill: '#000000'}]}); x += 5; }
  return {pages: [{n: 1, x0: 0, y0: 0, width: 600, height: 800, shows, marks: []}], fonts: {f: {name: 'F', fm: [0.001], glyphs: {}}}};
};

test('finding a text: emoji before it, ligatures, quotes and a hyphen drawn on its own', () => {
  const doc = page('😀', ' ', 'e', 'ﬃ', 'cient', ' ', 'sign', '-', 'ups', ' ', '“ok”');
  const found = findItem(doc, 'efficient sign-ups "ok"');
  assert.ok(found, 'found after an emoji (two UTF-16 units) and through the ffi ligature');
  const glyphs = found.map(({k}) => doc.pages[0].shows[k].glyphs[0].u).join('');
  assert.equal(glyphs, 'eﬃcient sign-ups “ok”', 'the hyphen and spaces between its letters belong to it');
  assert.equal(docText(doc).text.length, docText(doc).at.length, 'one entry per UTF-16 unit');
});

test('finding a text: a show that also carries other text is not taken; claimed shows are skipped', () => {
  const doc = page('ab', ' ', 'cd');
  doc.pages[0].shows[0].glyphs.push({u: 'X', code: 2, x: 0, y: 20, w: 5, font: 'f', fill: '#000000'});   // "aX" in one show
  assert.equal(findItem(doc, 'X b cd'), null, 'the X show starts before the text');
  const twice = page('go', ' ', 'go');
  const first = findItem(twice, 'go'), claimed = new Set(first.map(({p, k}) => `${p}:${k}`));
  assert.notDeepEqual(findItem(twice, 'go', claimed), first, 'the second "go"');
});

test('a paragraph is measured as justified only when its full lines are stretched', async () => {
  const shapes = JSON.parse(fs.readFileSync(path.join(here, 'shapes.json'), 'utf8'));
  const word = await read(path.join(here, 'word-like.pdf')), latex = await read(path.join(here, 'latex-like.pdf'));
  assert.equal(measure(word, findItem(word, shapes['word-like'].cv.summary)).justified, true);
  const bullet = shapes['latex-like'].cv.jobs[0].roles[0].bullets[0];
  assert.equal(measure(latex, findItem(latex, bullet)).justified, false, 'a one-line bullet is ragged');
  const para = measure(latex, findItem(latex, shapes['latex-like'].cv.summary));
  assert.equal(para.justified, true);
  assert.ok(para.gap > 2 && para.gap < 5, 'the natural gap of a font without a space glyph comes from the last line');
});

test('writer: a font that lives on another page is added to the page that now uses it', async () => {
  const file = fs.readFileSync(path.join(here, 'table.pdf')), doc = await read(file);
  const k = doc.pages[0].shows.findIndex(s => s.glyphs.some(g => /[A-Z]/.test(g.u)));
  const font = doc.fonts[doc.pages[0].shows[k].font].name;
  const plan = {remove: [], add: [copyShow(doc, 0, k, {p: 1, y: 700})], marks: []};
  const after = await read(await writePdf(file, doc, plan));
  const moved = after.pages[1].shows.filter(s => Math.abs(s.y - 700) < 0.5);
  assert.equal(moved.length, 1);
  assert.equal(after.fonts[moved[0].font].name, font);
  assert.equal(moved[0].glyphs.map(g => g.u).join(''), doc.pages[0].shows[k].glyphs.map(g => g.u).join(''));
});

test('writer: refuses a file whose show operators do not match what pdf.js read', async () => {
  const doc = await read(path.join(here, 'band.pdf'));
  await assert.rejects(writePdf(fs.readFileSync(path.join(here, 'sidebar.pdf')), doc, {remove: [], add: [], marks: []}), /show operators|page/);
});
