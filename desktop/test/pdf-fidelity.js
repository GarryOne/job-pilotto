// Test helper: how faithful an edited CV PDF is to its original, from what lib/pdf-edit/read.js sees in both (no rendering, so it runs on
// every CI platform). Used by test/cv-inplace.test.js and test/pdf-edit.test.js.
import fs from 'node:fs';
import {readPdf} from '../lib/pdf-edit/read.js';
import {docText} from '../lib/pdf-edit/layout.js';

let pdfjs = null;
export const read = async bytes => readPdf(pdfjs ??= await import('pdfjs-dist/legacy/build/pdf.mjs'), typeof bytes === 'string' ? fs.readFileSync(bytes) : bytes);

const styles = doc => new Set(doc.pages.flatMap(p => p.shows).filter(s => s.glyphs.some(g => g.u.trim()))
  .map(s => `${doc.fonts[s.font].name}|${s.ps.toFixed(1)}`));
const glyphs = (doc, skip = new Set()) => doc.pages.flatMap((page, p) => page.shows.flatMap((s, k) => skip.has(`${p}:${k}`) ? [] :
  s.glyphs.filter(g => g.u.trim()).map(g => `${p}|${g.u}|${g.x.toFixed(1)}|${g.y.toFixed(1)}`)));

// before/after: read.js views. removed: the shows the plan re-set ({p, k}). -> what differs, as plain facts for asserts
export function compare(before, after, removed = []) {
  const skip = new Set(removed.map(({p, k}) => `${p}:${k}`));
  const after_ = new Set(glyphs(after));
  const lost = glyphs(before, skip).filter(g => !after_.has(g));
  const known = styles(before), strange = [...styles(after)].filter(s => !known.has(s));
  return {
    pages: [before.pages.length, after.pages.length],
    sizes: [before.pages.map(p => `${p.width.toFixed(1)}x${p.height.toFixed(1)}`).join(), after.pages.map(p => `${p.width.toFixed(1)}x${p.height.toFixed(1)}`).join()],
    lost,          // letters outside the edited items that moved or vanished (should be none)
    strange,       // font + size pairs the original never used (should be none)
  };
}

// Is this text printed in the document (letters compared as findItem does)?
export const prints = (doc, text) => docText(doc).text.includes(docText({pages: [{shows: [{glyphs: [{u: text}]}]}]}).text);
