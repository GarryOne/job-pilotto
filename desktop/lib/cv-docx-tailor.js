// Tailor for a Word CV: the person's own .docx (lib/cv-docx.js currentDocx) edited in place, each word in its own style (lib/docx/edit.js),
// then drawn to PDF the same way as the CV itself (LibreOffice, else the app's renderer). The review boxes are found on the drawn pages.
// Returns what lib/cv-inplace-run.js make returns, so kit-handlers saves and reviews it the same way; {why} sends Tailor to the PDF path.
// Guard: test/cv-docx-tailor.test.js.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {drawDocx} from './cv-docx.js';
import {tailorDocx} from './docx/edit.js';
import {readDocx, writeDocx} from './docx/zip.js';
import {findItem} from './pdf-edit/layout.js';

// One box per printed line of a found text: {p, x, y, w, h} like the PDF path's (top-left origin, points).
export function boxesOf(doc, shows) {
  const lines = new Map();
  for (const {p, k} of shows) {
    const s = doc.pages[p].shows[k], key = `${p}:${Math.round(s.y)}`, line = lines.get(key);
    if (!line) lines.set(key, {p, x0: s.x, x1: s.x1, y: s.y, ps: s.ps});
    else { line.x0 = Math.min(line.x0, s.x); line.x1 = Math.max(line.x1, s.x1); line.ps = Math.max(line.ps, s.ps); }
  }
  return [...lines.values()].map(l => ({p: l.p, x: l.x0, y: l.y - l.ps * 0.85, w: l.x1 - l.x0, h: l.ps * 1.1}));
}

// docx: the Word CV's path. applied: cvlib.applyTailoring's {cv, review, warnings}. readPdf(file): read.js's view of a PDF file.
// -> {pdf, docx, warnings, review, inPlace: {boxes, pages, changed, kept, fonts, from: 'docx', by}} or {why}
export async function makeDocx(storage, docx, applied, base, {readPdf, renderDocx, soffice = null, faces, convert}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-tailor-docx-'));
  try {
    const {zip, xml} = await readDocx(fs.readFileSync(docx));
    const result = tailorDocx(xml, base, applied.review);
    if (!result.changed && !result.moved) return {why: 'nothing could be changed in the Word file'};
    const bytes = await writeDocx(zip, result.xml);
    const {pdf, by} = await drawDocx(storage, bytes, {soffice, renderDocx, faces, convert});
    const file = path.join(temp, 'cv.pdf');
    fs.writeFileSync(file, pdf);
    const doc = await readPdf(file), claimed = new Set(), boxes = [];
    // Reworded texts, then bullets only moved (their words unchanged): each found once on the drawn pages.
    const moved = result.moved ? (applied.review.jobs || []).flatMap(j => (j.roles || []).flatMap(r => (r.bullets || []).filter(b => b.mark === 'moved'))) : [];
    for (const e of [...result.edited.map(x => ({...x, mark: 'reworded'})), ...moved.map(b => ({text: b.text, before: b.text, mark: 'moved'}))]) {
      const shows = findItem(doc, e.text, claimed);
      if (!shows) continue;
      shows.forEach(s => claimed.add(`${s.p}:${s.k}`));
      boxes.push(...boxesOf(doc, shows).map(b => ({...b, mark: e.mark, before: e.before})));
    }
    // no drops in the person's own design (as the PDF path): the review lists none as removed
    const review = structuredClone(applied.review);
    for (const job of review.jobs || []) for (const role of job.roles || []) if (role.dropped?.length) role.dropped = [];
    const warnings = [...new Set([...applied.warnings.filter(w => !/bullets were left out/.test(w)), ...result.warnings])];
    if (by === 'app') warnings.push('Drawn by the app while LibreOffice downloads: tailor again later for a PDF closer to Word');
    return {pdf, docx: bytes, warnings, review,
      inPlace: {boxes, pages: doc.pages.map(p => ({width: p.width, height: p.height})), changed: result.changed, kept: result.kept, fonts: [], from: 'docx', by}};
  } catch (error) {
    return {why: String(error.message || error).slice(0, 120)};
  } finally { fs.rmSync(temp, {recursive: true, force: true}); }
}
