// lib/cv-inplace.js + lib/pdf-edit/: a tailored CV is the person's own PDF with only the changed wording re-set. Run on every made-up CV
// shape in test/fixtures/cv-shapes (Chromium CID fonts, Type 3 fonts, two columns, a dark band with a photo, a table over two pages,
// Word-like justified text, LaTeX-like text without space glyphs): same pages, same fonts and sizes, nothing outside the edited items moves,
// the new wording is printed and the old one is gone, bullets reordered with their markers.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {applyTailoring} from '../lib/cv.js';
import {itemsOf, planInPlace, roomOf} from '../lib/cv-inplace.js';
import {resetItem} from '../lib/pdf-edit/layout.js';
import {writePdf} from '../lib/pdf-edit/write.js';
import {compare, prints, read} from './pdf-fidelity.js';

const here = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'cv-shapes');
const shapes = JSON.parse(fs.readFileSync(path.join(here, 'shapes.json'), 'utf8'));
const pdfOf = name => fs.readFileSync(path.join(here, `${name}.pdf`));
// The made-up tailorings that ask for more lines than an item has, on purpose: that item keeps its wording.
const LONGER = {sidebar: 1, table: 1};

test('every CV shape has a PDF, a cv.json and a tailoring', () => {
  const pdfs = fs.readdirSync(here).filter(f => f.endsWith('.pdf')).map(f => f.replace(/\.pdf$/, '')).sort();
  assert.deepEqual(Object.keys(shapes).sort(), pdfs);
  for (const {cv, tailoring} of Object.values(shapes)) assert.ok(cv.jobs.length && tailoring.jobs.length === cv.jobs.length);
});

for (const [name, {cv, tailoring}] of Object.entries(shapes)) {
  test(`${name}: every summary and bullet of the CV is found on its page`, async () => {
    const items = itemsOf(await read(pdfOf(name)), cv);
    assert.deepEqual(items.filter(i => !i.shows).map(i => i.text), []);
    const room = roomOf(items);
    assert.ok(room.summary >= cv.summary.length, 'the summary has at least its own length as room');
  });

  test(`${name}: tailored in place keeps the design`, async () => {
    const bytes = pdfOf(name), before = await read(bytes);
    const {review} = applyTailoring(cv, tailoring);
    const {plan, warnings, changed} = planInPlace(before, cv, review);
    assert.ok(changed > 0, 'something was re-set');
    assert.deepEqual(warnings.filter(w => /order/.test(w)), [], 'every new order fits');
    assert.equal(warnings.filter(w => /longer than its lines/.test(w)).length, LONGER[name] || 0, warnings.join('\n'));
    const after = await read(await writePdf(bytes, before, plan));
    const diff = compare(before, after, plan.remove);
    assert.deepEqual(diff.pages, [before.pages.length, before.pages.length], 'same page count');
    assert.equal(diff.sizes[0], diff.sizes[1], 'same page size');
    assert.deepEqual(diff.strange, [], 'no font or size the original did not use');
    assert.deepEqual(diff.lost.slice(0, 5), [], 'nothing outside the edited items moved');
    // the new wording is printed, the old one is gone
    const kept = new Set(warnings.filter(w => /kept your original wording/.test(w)).map(w => w.split(':')[0]));
    if (review.summaryMark) { assert.ok(prints(after, review.summary), 'new summary printed'); assert.ok(!prints(after, cv.summary), 'old summary gone'); }
    review.jobs.forEach((job, j) => job.roles.forEach((role, r) => role.bullets.forEach(b => {
      const where = `${cv.jobs[j].company} · ${cv.jobs[j].roles[r].title}`, original = cv.jobs[j].roles[r].bullets[b.from];
      if (b.mark !== 'reworded') return assert.ok(prints(after, original), `kept bullet still printed (${where})`);
      if (kept.has(where) && prints(after, original)) return;
      assert.ok(prints(after, b.text), `reworded bullet printed (${where}): ${b.text}`);
      assert.ok(!prints(after, original), `old bullet gone (${where})`);
    })));
  });

  test(`${name}: re-setting every item with its own words reproduces the page`, async () => {
    const bytes = pdfOf(name), before = await read(bytes);
    const plan = {remove: [], add: [], marks: []};
    for (const item of itemsOf(before, cv)) {
      const r = resetItem(before, item.shows, item.text);
      assert.ok(r.fits, `${item.where}: its own words fit its own lines`);
      plan.remove.push(...r.remove); plan.add.push(...r.add);
    }
    const after = await read(await writePdf(bytes, before, plan));
    // each re-set letter lands where the original had it (within half a point) for nearly all letters
    const at = doc => doc.pages.flatMap((page, p) => page.shows.flatMap(s => s.glyphs.filter(g => g.u.trim()).map(g => ({p, u: g.u, x: g.x, y: g.y}))));
    const old = at(before), fresh = at(after);
    const near = old.filter(g => fresh.some(h => h.p === g.p && h.u === g.u && Math.abs(h.x - g.x) < 0.5 && Math.abs(h.y - g.y) < 0.5)).length;
    assert.ok(near / old.length > 0.95, `${(100 * near / old.length).toFixed(1)}% of letters in place`);
  });
}

test('bullets reordered on the page follow the tailoring, markers with them', async () => {
  const {cv, tailoring} = shapes.band, bytes = pdfOf('band'), before = await read(bytes);
  const {review} = applyTailoring(cv, tailoring);
  const {plan} = planInPlace(before, cv, review);
  assert.equal(plan.marks.length, 4, 'four vector markers moved with the first role\'s bullets');
  const after = await read(await writePdf(bytes, before, plan));
  const y = text => { const items = itemsOf(after, {jobs: [{company: 'x', roles: [{title: 'x', bullets: [text]}]}]}); return items[0].para.lines[0].y; };
  const order = review.jobs[0].roles[0].bullets.map(b => y(b.text));
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'printed top to bottom in the new order');
  const markers = after.pages[0].marks.filter(m => m.x < 30).map(m => m.y + m.h / 2).sort((a, b) => a - b).slice(0, 4);
  order.forEach((line, i) => assert.ok(Math.abs(markers[i] - (line - 3)) < 4, `marker ${i} beside its bullet`));
});
