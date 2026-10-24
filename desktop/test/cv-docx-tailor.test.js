// lib/cv-docx-tailor.js: Tailor on a made-up Word CV: the .docx edited in place and drawn to PDF, the review boxes found on the drawn
// pages (a reworded bullet, a moved one), nothing dropped, and {why} (the PDF path) when the Word file can't take the change.
// The renderer is a stub that keeps the edited Word file; the "PDF reader" lays each of its paragraphs out as one printed line.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {applyTailoring} from '../lib/cv.js';
import {makeDocx} from '../lib/cv-docx-tailor.js';
import {paragraphsOf} from '../lib/docx/xml.js';
import {readDocx} from '../lib/docx/zip.js';

const here = path.join(import.meta.dirname, 'fixtures', 'cv-docx');
const {cv} = JSON.parse(fs.readFileSync(path.join(here, 'shapes.json'), 'utf8')).classic;
const word = path.join(here, 'classic.docx');
const storage = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-docx-tailor-')); return {path: name => path.join(root, name)}; };

function stubs() {
  const seen = {};
  return {seen,
    renderDocx: async bytes => { seen.docx = bytes; return {pdf: Buffer.from('%PDF-1.7 stub')}; },
    readPdf: async () => {
      const {xml} = await readDocx(seen.docx);
      const shows = paragraphsOf(xml).filter(p => p.text.trim()).map((p, i) => ({x: 50, x1: 50 + p.text.length * 4, y: 60 + i * 14, ps: 10, glyphs: [...p.text].map(u => ({u}))}));
      return {pages: [{width: 595, height: 842, shows}]};
    },
    faces: async () => []};
}
// The first role's bullets: the second reworded, the third moved to the top.
function tailored() {
  const roles = cv.jobs.map(job => ({company: job.company, roles: job.roles.map(role => ({title: role.title, skills: '', bullets: role.bullets.map((text, source) => ({source, text}))}))}));
  const first = roles[0].roles[0].bullets;
  first[1] = {source: 1, text: `${first[1].text.replace(/\.$/, '')}, on time and on budget.`};
  first.unshift(first.splice(2, 1)[0]);
  return applyTailoring(cv, {summary: cv.summary, jobs: roles, changes: []});
}

test('a Word CV tailored in place: the edited .docx drawn to PDF, a box on the reworded and on the moved bullet', async () => {
  const s = stubs(), applied = tailored();
  const made = await makeDocx(storage(), word, applied, cv, {readPdf: s.readPdf, renderDocx: s.renderDocx, faces: s.faces});
  assert.equal(made.why, undefined, made.why);
  assert.equal(made.pdf.toString(), '%PDF-1.7 stub');
  assert.deepEqual(made.docx, s.seen.docx, 'the edited Word file comes back too');
  const texts = paragraphsOf((await readDocx(made.docx)).xml).map(p => p.text);
  const reworded = applied.review.jobs[0].roles[0].bullets.find(b => b.mark === 'reworded').text.replace(/\*\*/g, '');   // the review marks bold as **…**
  assert.ok(texts.includes(reworded), 'the new wording is in the Word file');
  assert.deepEqual(made.inPlace.boxes.map(b => b.mark).sort(), ['moved', 'reworded']);
  assert.ok(made.inPlace.boxes.every(b => b.p === 0 && b.w > 0 && b.h > 0));
  // The review screen reads what the PDF path gives (lib/cv-inplace-run.js make): the same fields, so the Word path keeps every feature.
  for (const field of ['boxes', 'pages', 'changed', 'kept', 'fonts']) assert.ok(field in made.inPlace, field);
  for (const field of ['pdf', 'warnings', 'review']) assert.ok(field in made, field);
  assert.equal(made.inPlace.from, 'docx');
  assert.equal(made.inPlace.by, 'app');
  assert.match(made.warnings.join(' '), /while LibreOffice downloads/);
});

test('LibreOffice there: it draws the tailored Word file, no "downloading" warning', async () => {
  const s = stubs();
  const made = await makeDocx(storage(), word, tailored(), cv, {readPdf: s.readPdf, renderDocx: s.renderDocx, faces: s.faces, soffice: '/lo/soffice',
    convert: async (soffice, bytes) => { s.seen.docx = bytes; return Buffer.from('%PDF-1.7 LibreOffice'); }});
  assert.equal(made.inPlace.by, 'libreoffice');
  assert.doesNotMatch(made.warnings.join(' '), /LibreOffice downloads/);
});

test('nothing the Word file can take: {why}, so Tailor uses the PDF path', async () => {
  const s = stubs();
  const same = applyTailoring(cv, {summary: cv.summary, jobs: cv.jobs.map(job => ({company: job.company, roles: job.roles.map(role => ({title: role.title, skills: '',
    bullets: role.bullets.map((text, source) => ({source, text}))}))})), changes: []});
  const made = await makeDocx(storage(), word, same, cv, {readPdf: s.readPdf, renderDocx: s.renderDocx, faces: s.faces});
  assert.match(made.why, /nothing could be changed/);
});
