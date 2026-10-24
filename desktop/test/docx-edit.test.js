// lib/docx/: a Word CV tailored in place, on two made-up Word files (test/fixtures/cv-docx/make.mjs): every item found in its paragraph,
// words replaced in their own style (a bold number stays bold), bullets reordered as paragraphs, everything else byte for byte.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {applyTailoring} from '../lib/cv.js';
import {itemsOfDocx, rewrite, tailorDocx} from '../lib/docx/edit.js';
import {paragraphsOf} from '../lib/docx/xml.js';
import {readDocx, writeDocx} from '../lib/docx/zip.js';

const here = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'cv-docx');
const shapes = JSON.parse(fs.readFileSync(path.join(here, 'shapes.json'), 'utf8'));
const open = async name => readDocx(fs.readFileSync(path.join(here, `${name}.docx`)));
const texts = xml => paragraphsOf(xml).map(p => p.text);
const runsOf = (xml, needle) => { const p = paragraphsOf(xml).find(x => x.text.includes(needle)); return p.pieces.filter(x => x.kind === 't').map(x => ({text: p.text.slice(x.at, x.at + x.len), bold: /<w:b\/>/.test(p.runs[x.run].rPr)})); };

test('reading: a paragraph split over several runs and spell-check marks is one text; bullets know they are numbered', async () => {
  const {xml} = await open('classic');
  const paras = paragraphsOf(xml);
  assert.ok(paras.some(p => p.text === 'Planned four annual shutdowns of 12 days each with 300 contractors on site.' && p.numbered));
  assert.ok(paras.some(p => p.text.startsWith('Maintenance planner with eleven years in paper mills')));
  assert.ok(paras.some(p => p.text.includes('henrik.a@example.org')), 'the text inside a link');
});

for (const [name, {cv}] of Object.entries(shapes)) {
  test(`${name}: every summary paragraph and bullet is found in the Word file`, async () => {
    const {xml} = await open(name);
    assert.deepEqual(itemsOfDocx(paragraphsOf(xml), cv).filter(i => !i.at).map(i => i.text), []);
  });

  test(`${name}: re-setting every item with its own words changes no text and no style`, async () => {
    const {xml} = await open(name);
    const same = applyTailoring(cv, {summary: cv.summary, jobs: cv.jobs.map(job => ({company: job.company, roles: job.roles.map(role => ({title: role.title, skills: '',
      bullets: role.bullets.map((text, source) => ({source, text}))}))})), changes: []}).review;
    const out = tailorDocx(xml, cv, same);
    assert.equal(out.changed, 0);
    assert.equal(out.xml, xml, 'nothing rewritten when nothing changed');
  });
}

test('classic: tailored in place: the new summary keeps its bold words, bullets in the new order, other parts byte for byte', async () => {
  const {cv, tailoring} = shapes.classic, {zip, xml} = await open('classic');
  const before = Object.fromEntries(await Promise.all(Object.keys(zip.files).filter(n => n !== 'word/document.xml').map(async n => [n, await zip.file(n)?.async('nodebuffer')])));
  const out = tailorDocx(xml, cv, applyTailoring(cv, tailoring).review);
  assert.deepEqual(out.warnings, []);
  assert.equal(out.moved, 2);
  const after = texts(out.xml);
  assert.ok(after.includes('Maintenance planner with eleven years in paper mills and food plants. I plan shutdowns that finish on time and keep spare parts honest in SAP PM.'));
  assert.deepEqual(runsOf(out.xml, 'Maintenance planner').filter(r => r.bold).map(r => r.text.trim()), ['eleven years'], 'the bold words stay bold, nothing else turns bold');
  assert.deepEqual(runsOf(out.xml, 'Cut emergency').filter(r => r.bold).map(r => r.text.trim()), ['35% to 18%']);
  const order = ['Set up spare parts', 'Planned four', 'Cut emergency', 'Trained six', 'Wrote step-by-step', 'Repaired filling'].map(s => after.findIndex(t => t.startsWith(s)));
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'the bullets in the tailored order');
  assert.ok(!after.some(t => t.startsWith('Set up the spare parts')), 'the old wording is gone');
  assert.equal(after.length, texts(xml).length, 'same number of paragraphs: nothing dropped');
  // the file round-trips and every other part is unchanged
  const again = await readDocx(await writeDocx(zip, out.xml));
  assert.equal(again.xml, out.xml);
  for (const [n, bytes] of Object.entries(before)) if (bytes) assert.deepEqual(await again.zip.file(n).async('nodebuffer'), bytes, n);
});

test('table: summary paragraphs and typed-bullet list lines re-set one by one, the typed bullet and tab kept', async () => {
  const {cv, tailoring} = shapes.table, {xml} = await open('table');
  const out = tailorDocx(xml, cv, applyTailoring(cv, tailoring).review);
  assert.deepEqual(out.warnings, []);
  const after = texts(out.xml);
  assert.ok(after.includes('Head chef with twelve years in hotel kitchens across Spain.'));
  assert.ok(after.includes('I like calm banquet services and clear prep lists.'));
  assert.ok(after.includes('•\tRewrote the menu each season with local suppliers; food cost fell from 34% to 29%.'), 'the typed bullet and its tab stay');
  assert.ok(after.indexOf('•\tRewrote the menu each season with local suppliers; food cost fell from 34% to 29%.') < after.indexOf('•\tRun a kitchen of 14 cooks serving 220 covers a night in summer.'));
  const flat = applyTailoring(cv, {...tailoring, summary: tailoring.summary.replace(/\n/g, ' ')}).review;
  assert.deepEqual(tailorDocx(xml, cv, flat).warnings, ['Summary: the new summary has another number of paragraphs; kept your original wording']);
});

test('a text that crosses the edge of a link is never cut; the item keeps its wording', async () => {
  const {xml} = await open('classic');
  const para = paragraphsOf(xml).find(p => p.text.includes('henrik.a@example.org'));
  assert.equal(rewrite(xml, para, 0, para.text.indexOf('example'), 'Somewhere else · someone@'), null);
  assert.ok(rewrite(xml, para, 0, para.text.indexOf(' · ') , 'Turku, Finland'), 'a range before the link can be rewritten');
});
