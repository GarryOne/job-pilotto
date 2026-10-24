// lib/cv-inplace-run.js + the in-place parts of lib/cv.js: when the person's own PDF is edited (cv.json read from this very PDF, its items
// found), the prompt's room per text and no-drop rule, the edited PDF with nothing dropped, and the review on the real pages.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import * as cvlib from '../lib/cv.js';
import {make, prepare} from '../lib/cv-inplace-run.js';
import {createStorage} from '../lib/storage.js';
import {read, prints} from './pdf-fidelity.js';

const here = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'cv-shapes');
const shapes = JSON.parse(fs.readFileSync(path.join(here, 'shapes.json'), 'utf8'));
const tempStorage = () => createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-inplace-')), {encrypt: v => v, decrypt: v => v});
// A storage whose CV is the band shape: cv.pdf, and cv.json read from it (import.json names its hash).
function withCv(name = 'band', {sameFile = true} = {}) {
  const storage = tempStorage(), pdf = fs.readFileSync(path.join(here, `${name}.pdf`));
  fs.writeFileSync(storage.path('cv.pdf'), pdf);
  fs.mkdirSync(cvlib.dir(storage), {recursive: true});
  fs.writeFileSync(path.join(cvlib.dir(storage), 'cv.json'), JSON.stringify(shapes[name].cv));
  const hash = crypto.createHash('sha256').update(sameFile ? pdf : Buffer.from('another file')).digest('hex').slice(0, 16);
  fs.writeFileSync(path.join(cvlib.dir(storage), 'import.json'), JSON.stringify({pdf: hash}));
  return storage;
}
const reader = name => () => read(path.join(here, `${name}.pdf`));

test('prepare: in place only for the PDF cv.json was read from, with a room per text', async () => {
  const own = await prepare(withCv(), shapes.band.cv, reader('band'));
  assert.ok(own.doc && own.bytes, own.why);
  assert.ok(own.room.summary >= shapes.band.cv.summary.length);
  assert.ok(own.room.jobs[0][0][0] >= shapes.band.cv.jobs[0].roles[0].bullets[0].length);
  assert.match((await prepare(withCv('band', {sameFile: false}), shapes.band.cv, reader('band'))).why, /not read from this PDF/);
  assert.match((await prepare(withCv(), shapes.band.cv, () => { throw new Error('broken'); })).why, /could not be read/);
  const other = structuredClone(shapes.band.cv);
  other.summary = 'Someone else entirely.'; for (const job of other.jobs) for (const role of job.roles) role.bullets = role.bullets.map(b => `${b} (edited by hand)`);
  assert.match((await prepare(withCv(), other, reader('band'))).why, /bullets found/);
  const nothing = {...structuredClone(shapes.band.cv), summary: 'Written by the import, not on the page.', jobs: []};   // nothing to edit: the template
  assert.match((await prepare(withCv(), nothing, reader('band'))).why, /nothing found|bullets found/);
});

test('the prompt in place: max_chars per text, keep every bullet, no extra bullets offered', async () => {
  const storage = withCv(), base = structuredClone(shapes.band.cv);
  base.jobs[0].roles[0].bullets.push('An extra bullet from another CV version.'); base.jobs[0].roles[0].extra = [4];
  let asked = null;
  const client = {messages: {create: async request => { asked = request; return {stop_reason: 'end_turn', usage: {}, content: [{type: 'text', text: JSON.stringify(shapes.band.tailoring)}]}; }}};
  await cvlib.tailor(storage, {title: 'Designer', company: 'Acme', description: 'x'}, '', {client, base, room: {summary: 240, jobs: {0: {0: {0: 120}}}}});
  assert.match(asked.system, /Keep every bullet/);
  const cv = JSON.parse(asked.messages[0].content.match(/<cv>\n([\s\S]*?)\n<\/cv>/)[1]);
  assert.equal(cv.summary_max_chars, 240);
  assert.equal(cv.jobs[0].roles[0].bullets[0].max_chars, 120);
  assert.ok(!cv.jobs[0].roles[0].bullets.some(b => b.extra), 'the extra bullet is not offered');
  await cvlib.tailor(storage, {title: 'Designer', company: 'Acme', description: 'x'}, '', {client, base, room: {summary: null, summaryParts: [80, 120], jobs: {}}});
  const parts = JSON.parse(asked.messages[0].content.match(/<cv>\n([\s\S]*?)\n<\/cv>/)[1]);
  assert.deepEqual(parts.summary_paragraphs_max_chars, [80, 120]);
  assert.equal(parts.summary_max_chars, undefined);
  assert.match(asked.system, /same number of lines/);
  await cvlib.tailor(storage, {title: 'Designer', company: 'Acme', description: 'x'}, '', {client, base});
  assert.doesNotMatch(asked.system, /Keep every bullet/, 'the template path keeps today\'s prompt');
});

test('make: a dropped bullet goes back on the page and the review lists nothing as removed', async () => {
  const storage = withCv(), base = shapes.band.cv, own = await prepare(storage, base, reader('band'));
  const answer = structuredClone(shapes.band.tailoring);
  const dropped = answer.jobs[1].roles[0].bullets.pop();   // the model left one out
  const applied = cvlib.applyTailoring(base, answer);
  assert.ok(applied.review.jobs[1].roles[0].dropped.length, 'the template path would drop it');
  const edited = await make(own, base, applied, {off: true});
  assert.ok(!edited.why, edited.why);
  assert.deepEqual(edited.review.jobs[1].roles[0].dropped, []);
  const after = await read(edited.pdf);
  assert.ok(prints(after, base.jobs[1].roles[0].bullets[dropped.source]), 'still on the page');
  assert.equal(after.pages.length, own.doc.pages.length);
  assert.ok(edited.inPlace.boxes.length && edited.inPlace.changed > 0);
});

test('make: a file that cannot be written says why, so the template is used', async () => {
  const storage = withCv(), base = shapes.band.cv, own = await prepare(storage, base, reader('band'));
  own.bytes = fs.readFileSync(path.join(here, 'sidebar.pdf'));   // operators no longer match what was read
  const edited = await make(own, base, cvlib.applyTailoring(base, shapes.band.tailoring), {off: true});
  assert.match(edited.why, /show operators|page/);
});

test('review of an in-place CV: the real pages with the changed lines boxed, and the same panel', async () => {
  const storage = withCv(), base = shapes.band.cv, own = await prepare(storage, base, reader('band'));
  const applied = cvlib.applyTailoring(base, shapes.band.tailoring), edited = await make(own, base, applied, {off: true});
  const record = {job: {code: 'J1', title: 'Designer', company: 'Acme'}, createdAt: new Date().toISOString(), model: 'm', usd: 0,
    changes: shapes.band.tailoring.changes || [], warnings: edited.warnings, cv: applied.cv, review: edited.review, inPlace: edited.inPlace};
  cvlib.save(storage, 'J1', record, edited.pdf);
  const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  cvlib.savePages(storage, 'J1', edited.inPlace.pages.map(() => pixel));
  const html = fs.readFileSync(cvlib.reviewPage(storage, record), 'utf8');
  assert.match(html, /class="page fixed ip-page"/);
  assert.equal((html.match(/class="ip-mark /g) || []).length, edited.inPlace.boxes.length);
  assert.ok(edited.inPlace.boxes.every(b => ['reworded', 'moved'].includes(b.mark)), 'a bullet only pushed down has no box');
  assert.match(html, /title="Before: Product designer with eight years/, 'the wording before, on hover');
  for (const feature of ['Final CV: send this one', 'Hide highlights', 'What changed and why', 'jp-legend']) assert.ok(html.includes(feature), feature);
  // without the page pictures (an older record), the template review as before
  fs.rmSync(path.join(path.dirname(cvlib.pdfPath(storage, 'J1')), 'J1.p1.png'));
  assert.doesNotMatch(fs.readFileSync(cvlib.reviewPage(storage, record), 'utf8'), /ip-page/);
});
