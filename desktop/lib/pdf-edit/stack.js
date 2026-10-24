// Re-stacks a block of bullets (one role's) in a new order inside the block's own lines: same line pitch and gap between bullets as the
// original, each bullet in its own indentation and style, its marker (a glyph or a small vector shape) moving with it. Pure, like layout.js.
// Guards: test/cv-inplace.test.js.
import {setWords, lineOp, copyShow} from './layout.js';

const med = list => { const t = [...list].sort((a, b) => a - b); return t.length ? t[Math.floor(t.length / 2)] : null; };
const NOT_TEXT = /^[^\p{L}\p{N}]$/u;

// The marker left of a paragraph's first line: shows of one non-letter glyph, or small filled shapes. -> {shows: [{p, k}], marks: [i]}
export function markersOf(doc, para) {
  const first = para.lines[0], page = doc.pages[first.p], ps = para.ps;
  const shows = page.shows.map((s, k) => ({s, k})).filter(({s}) => Math.abs(s.y - first.y) < ps * 0.4 && s.x1 <= first.x0 + 0.5 && s.x >= first.x0 - ps * 3
    && s.glyphs.filter(g => g.u.trim()).length === 1 && NOT_TEXT.test(s.glyphs.find(g => g.u.trim()).u)).map(({k}) => ({p: first.p, k}));
  const marks = page.marks.map((m, i) => ({m, i})).filter(({m}) => m.x + m.w <= first.x0 + 0.5 && m.x >= first.x0 - ps * 3
    && m.y + m.h / 2 <= first.y + 0.5 && m.y + m.h / 2 >= first.y - ps).map(({i}) => i);
  return {shows, marks};
}

// paras: the block's bullets in their original order (layout.measure), markers: markersOf each. order: the new order as indexes into paras.
// texts: the new wording of each para (by original index). -> {remove, add, marks, boxes: [[box]] by original index}, or {why} when it can't.
export function restack(doc, paras, markers, order, texts) {
  const lines = paras.flatMap(p => p.lines);
  const segs = [];
  for (const l of lines) { const seg = segs.find(s => s.p === l.p); if (seg) { seg.top = Math.min(seg.top, l.y); seg.bottom = Math.max(seg.bottom, l.y); } else segs.push({p: l.p, top: l.y, bottom: l.y}); }
  const pitch = med(paras.flatMap(p => p.lines.slice(1).map((l, i) => l.p === p.lines[i].p ? l.y - p.lines[i].y : null)).filter(v => v > 0));
  const gap = med(paras.slice(1).map((p, i) => { const a = paras[i].lines[paras[i].lines.length - 1], b = p.lines[0]; return a.p === b.p ? b.y - a.y : null; }).filter(v => v > 0));
  const L = pitch ?? gap ?? paras[0].leading, G = gap ?? L;
  // nothing else may sit inside the block (a heading or a date between bullets): moving lines over it would collide
  const mine = new Set([...paras.flatMap(p => p.shows), ...markers.flatMap(m => m.shows)].map(({p, k}) => `${p}:${k}`));
  for (const seg of segs) {
    const segLines = lines.filter(l => l.p === seg.p), left = Math.min(...segLines.map(l => l.x0)) - paras[0].ps * 3, right = Math.max(...paras.map(p => p.right));
    const other = doc.pages[seg.p].shows.some((s, k) => !mine.has(`${seg.p}:${k}`) && s.glyphs.some(g => g.u.trim()) && s.y > seg.top - s.ps * 0.5 && s.y < seg.bottom + s.ps * 0.5 && s.x < right && s.x1 > left);
    if (other) return {why: 'other text inside the block'};
  }
  const add = [], marks = [], boxes = [];
  let seg = 0, y = segs[0].top, started = false;
  for (const i of order) {
    const para = paras[i], set = setWords(para, texts[i], Infinity);
    if (set.missing) return {why: `no glyph for "${set.missing}"`, missingBy: set.missingBy};
    const placed = [];
    for (let li = 0; li < set.lines.length; li++) {
      if (started) y += li === 0 ? G : L;
      started = true;
      if (y > segs[seg].bottom + L * 0.25) {   // printers snap baselines to pixels: pitches vary by a fraction of a point
        seg++; if (!segs[seg]) return {why: 'longer than the block'}; y = segs[seg].top; }
      placed.push({p: segs[seg].p, y});
    }
    const ops = set.lines.map((ws, li) => lineOp(para, ws, {p: placed[li].p, y: placed[li].y, x: para.x0(li), last: li === set.lines.length - 1}));
    add.push(...ops);
    boxes[i] = ops.map(o => o.box);
    const first = para.lines[0], to = placed[0];
    for (const {p, k} of markers[i].shows) add.push(copyShow(doc, p, k, {p: to.p, y: to.y + (doc.pages[p].shows[k].y - first.y)}));
    for (const mi of markers[i].marks) marks.push({p: first.p, i: mi, to: {p: to.p, dy: to.y - first.y}});
  }
  const remove = [...paras.flatMap(p => p.shows), ...markers.flatMap(m => m.shows)];
  return {remove, add, marks, boxes};
}
