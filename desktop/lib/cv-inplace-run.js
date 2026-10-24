// Tailor CV's in-place path, between the app and lib/cv-inplace.js: is the person's own PDF editable (cv.json made from this very PDF, its
// items found on the pages), what room each text has for the tailoring prompt, and the edited PDF with what the review needs. When the file
// can't be edited the caller prints today's template instead (no second AI call). Guards: test/cv-inplace-run.test.js.
import fs from 'node:fs';
import * as cvlib from './cv.js';
import {itemsOf, roomOf, tailorInPlace} from './cv-inplace.js';
import {writePdf} from './pdf-edit/write.js';

// readPdf: () => read.js's view of cv.pdf (from the hidden probe window). -> {bytes, doc, room} or {why} when the template is used.
export async function prepare(storage, base, readPdf) {
  const file = storage.path('cv.pdf');
  if (!fs.existsSync(file)) return {why: 'no CV PDF'};
  if (cvlib.importedFrom(storage) !== cvlib.pdfHash(storage)) return {why: 'the CV data was not read from this PDF'};
  let doc;
  try { doc = await readPdf(); } catch (error) { return {why: `the PDF could not be read (${String(error.message || error).slice(0, 80)})`}; }
  if (!doc?.pages?.some(p => p.shows.length)) return {why: 'the PDF has no text layer'};
  const items = itemsOf(doc, base), bullets = items.filter(i => i.kind === 'bullet');
  const found = bullets.filter(i => i.shows).length;
  if (!items.some(i => i.kind === 'summary' && i.shows) && found < bullets.length * 0.6) return {why: `only ${found} of ${bullets.length} bullets found on the page`};
  return {bytes: fs.readFileSync(file), doc, room: roomOf(items)};
}

// own: what prepare returned. applied: cvlib.applyTailoring's {cv, review, warnings}. fonts: fonts.js options (cacheDir).
// -> {pdf, warnings, review, inPlace: {boxes, pages, changed, kept, fonts}}, or {why} when writing failed (the template is used).
export async function make(own, base, applied, fonts = {}) {
  try {
    const result = await tailorInPlace(own.doc, base, applied.review, fonts);
    const pdf = Buffer.from(await writePdf(own.bytes, own.doc, result.plan, {embeds: result.embeds}));
    // no drops in the person's own design: a bullet the answer left out is back on the page, so the review lists none as removed
    const review = structuredClone(applied.review);
    for (const job of review.jobs || []) for (const role of job.roles || []) if (role.dropped?.length) role.dropped = [];
    const warnings = [...new Set([...applied.warnings.filter(w => !/bullets were left out/.test(w)), ...result.warnings])];
    for (const f of result.found) warnings.push(`Letters ${f.letters} come from ${f.from === 'installed' ? 'the same font on this computer' : f.from === 'download' ? 'the same free font, downloaded' : 'a free font of the same width'}`);
    return {pdf, warnings, review, inPlace: {boxes: result.boxes, pages: own.doc.pages.map(p => ({width: p.width, height: p.height})), changed: result.changed, kept: result.kept, fonts: result.found}};
  } catch (error) {
    return {why: String(error.message || error).slice(0, 120)};
  }
}
