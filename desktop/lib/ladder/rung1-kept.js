// Rung 1 of the ladder: the kept answer per page shape (docs/flows/ladder.md). The page's shape key (its host and its path with the per-job parts blanked), how it is built, the cache of answers
// kept on this Mac, and the self-correction that drops a kept answer the page contradicts. No AI and no page text here: rung 2 (rung2-sketch.js) asks when nothing is kept.
// Invariants (flow core: read before editing; changing one is the owner's call, said in the commit; each names the test that guards it):
//  1. A kept kind the page contradicts is forgotten and asked again (desktop/test/page-kind.test.js).
//  2. The key never holds a query string or any text of the page: host, blanked path and a fixed build code only (desktop/test/page-kind.test.js).
import fs from 'node:fs';

// The page's shape for the cache: its host and its path with the parts that differ per job (numbers, ids, long tokens) blanked,
// so every posting of one site is one shape and the same sign-in page is asked once. The query string is dropped (tokens).
export function pageShape(url) {
  let host = '', path = '';
  try { const parsed = new URL(String(url)); host = parsed.hostname; path = parsed.pathname; } catch { return ''; }
  const parts = path.split('/').filter(Boolean).map(part => (/\d/.test(part) || part.length > 24 ? '*' : part.toLowerCase()));
  return `${host}/${parts.join('/')}`;
}

// How the page is built, from its controls alone (no words): a password, a file upload, a text box, and how many other fields (0,
// 1-2, 3-7, 8+). Part of the cache key, so two pages at the same address shape that are built differently (a job page carrying the
// form, another with only an Apply link: 8 Oct 2026, the matrix's chain posting took the Greenhouse form's "form") are asked apart.
export function pageBuild(controls = []) {
  const types = (Array.isArray(controls) ? controls : []).map(item => String(item?.type || '').toLowerCase());
  const others = types.filter(type => !['password', 'file', 'textarea', 'hidden'].includes(type)).length;
  const bucket = others === 0 ? '0' : others <= 2 ? '1-2' : others <= 7 ? '3-7' : '8+';
  return `${types.includes('password') ? 'p' : ''}${types.includes('file') ? 'f' : ''}${types.includes('textarea') ? 't' : ''}${bucket}`;
}
// The cache key: the address shape and how the page is built.
export const kindKey = raw => { const shape = pageShape(raw?.url); return shape ? `${shape}|${pageBuild(raw?.controls)}` : ''; };

// The answers kept on this Mac, per page shape and build (a cache: deleting it only means asking again).
export function pageKindCache(file) {
  let kept = {};
  try { kept = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { /* none yet */ }
  return {
    get: shape => kept[shape] || null,
    set: (shape, entry) => { kept[shape] = entry; try { fs.writeFileSync(file, JSON.stringify(kept)); } catch { /* read-only: asked again next time */ } },
    forget: shape => { if (!(shape in kept)) return false; delete kept[shape]; try { fs.writeFileSync(file, JSON.stringify(kept)); } catch { /* read-only */ } return true; },
  };
}

// Self-correction (owner, 8 Oct 2026: "its mistakes must correct themselves"): the page contradicted the kind kept for it (a "form" with
// nothing to fill, a "posting" with no Apply but a form's fields), so the answer is dropped and the next visit asks again. Returns the
// key it dropped, or '' when nothing was kept for it.
export function forgetPageKind(cache, raw) {
  const key = kindKey(raw);
  return key && cache?.forget?.(key) ? key : '';
}
