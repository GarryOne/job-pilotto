// Sets new wording on a paragraph's own lines, measured from the original: where an item sits (findItem), how it is set (measure: left
// edges, leading, right edge, word gap, letter tightness, justified or ragged, each word's font and colour) and the new lines as glyph runs
// (setWords + lineOps). Pure: reads what read.js returns, hands write.js plain line operations. Positions are points from the page's top left.
// Guards: test/pdf-edit.test.js, test/cv-inplace.test.js.

// Letters compared when finding an item: spaces, soft hyphens and hyphens skipped, quotes and dashes folded, **bold** marks ignored.
const fold = ch => /[\s­\-‐-―−*]/.test(ch) ? '' : /[‘’‚′`]/.test(ch) ? "'" : /[“”„″]/.test(ch) ? '"' : ch;
const folded = text => [...String(text || '').normalize('NFKC')].map(fold).join('');   // NFKC: a ligature glyph (ﬁ) reads as its letters
const med = list => { const t = [...list].sort((a, b) => a - b); return t.length ? t[Math.floor(t.length / 2)] : null; };
const inked = g => g.u && g.u.trim();

// The document's letters in reading order, each knowing its show.
export function docText(doc) {
  if (doc._text) return doc._text;
  let text = ''; const at = [], range = new Map();
  doc.pages.forEach((page, p) => page.shows.forEach((s, k) => s.glyphs.forEach(g => {
    const f = folded(g.u), id = `${p}:${k}`;
    for (let i = 0; i < f.length; i++) {   // per UTF-16 unit, like indexOf (an emoji is two)
      const r = range.get(id) || [text.length, text.length];
      r[1] = text.length; range.set(id, r); at.push({p, k}); text += f[i];
    }
  })));
  Object.defineProperty(doc, '_text', {value: {text, at, range}, enumerable: false});
  return doc._text;
}

// Where a piece of text is printed: the shows that carry it, each lying wholly inside it (a show shared with other text can't be re-set).
// claimed: shows already taken by an earlier item. -> [{p, k}] in reading order, or null.
export function findItem(doc, text, claimed = new Set()) {
  const needle = folded(text), {text: hay, at, range} = docText(doc);
  if (needle.length < 2) return null;
  for (let from = hay.indexOf(needle); from >= 0; from = hay.indexOf(needle, from + 1)) {
    const ids = [...new Set(at.slice(from, from + needle.length).map(a => `${a.p}:${a.k}`))];
    if (ids.some(id => claimed.has(id))) continue;
    if (ids.some(id => { const r = range.get(id); return r[0] < from || r[1] >= from + needle.length; })) continue;
    const found = ids.map(id => { const [p, k] = id.split(':').map(Number); return {p, k}; });
    // shows of only skipped letters (a hyphen or a space drawn on its own) between the item's shows are part of it
    const between = [];
    for (const p of new Set(found.map(f => f.p))) {
      const ks = found.filter(f => f.p === p).map(f => f.k), lo = Math.min(...ks), hi = Math.max(...ks);
      for (let k = lo + 1; k < hi; k++) if (!range.has(`${p}:${k}`) && !claimed.has(`${p}:${k}`) && !ks.includes(k)) between.push({p, k});
    }
    return [...found, ...between].sort((a, b) => a.p - b.p || a.k - b.k);
  }
  return null;
}

const wordsOf = (glyphs, ps) => {   // a line's glyphs (left to right) cut into words where the gap is a space or a break
  const gs = glyphs.filter(inked).sort((a, b) => a.x - b.x), out = []; let word = [];
  gs.forEach((g, i) => { if (i && g.x - (gs[i - 1].x + gs[i - 1].w) > ps * 0.12) { out.push(word); word = []; } word.push(g); });
  if (word.length) out.push(word);
  return out;
};

// How a paragraph is set. shows: [{p, k}] from findItem.
export function measure(doc, shows) {
  const fonts = doc.fonts, list = shows.map(({p, k}) => ({p, k, s: doc.pages[p].shows[k]}));
  const lines = [];
  for (const {p, s} of list) {
    const line = lines.find(l => l.p === p && Math.abs(l.y - s.y) < s.ps * 0.4);
    if (line) { line.x0 = Math.min(line.x0, s.x); line.x1 = Math.max(line.x1, s.x1); line.shows.push(s); }
    else lines.push({p, y: s.y, x0: s.x, x1: s.x1, shows: [s]});
  }
  lines.sort((a, b) => a.p - b.p || a.y - b.y);
  const count = {}, styleOf = s => `${s.font}|${s.size}|${s.fill}`;
  for (const {s} of list) count[styleOf(s)] = (count[styleOf(s)] || 0) + s.glyphs.length;
  const top = Object.entries(count).sort((a, b) => b[1] - a[1])[0][0];
  const main = list.find(({s}) => styleOf(s) === top).s;
  const scale = Math.hypot(main.rm[0], main.rm[1]), ps = main.ps;
  // other subsets of the same face (Skia splits one face into several fonts) give letters a subset lacks
  const facesOf = key => Object.keys(fonts).filter(k => k !== key && fonts[k].name && fonts[k].name === fonts[key]?.name);
  const extra = doc.extraFonts || {};
  const glyphOf = (ch, pref = main.font) => {
    for (const key of [pref, ...facesOf(pref), main.font, ...facesOf(main.font)]) { const gl = fonts[key]?.glyphs[ch]; if (gl) return {key, fm: fonts[key].fm, ...gl}; }
    const more = extra[fonts[pref]?.name] || extra[fonts[main.font]?.name];
    const gl = more?.glyphs[ch]; return gl ? {key: more.key, fm: more.fm, ch, ...gl} : null;
  };
  const adv = gl => (gl.width * gl.fm[0] * main.size + main.tc) * main.th * scale;
  // the ligatures the original set (ﬁ, ﬂ …) are set again wherever their letters meet
  const ligs = Object.keys(fonts[main.font].glyphs).filter(u => [...u].length === 1 && u.normalize('NFKC').length > 1).sort((a, b) => b.normalize('NFKC').length - a.normalize('NFKC').length);
  const ligate = t => ligs.reduce((out, lig) => out.split(lig.normalize('NFKC')).join(lig), t);
  const cont = lines[lines.length > 1 ? 1 : 0];
  // the right edge: the widest line of the column (lines starting at the same left edge), but never so wide that the original
  // would have taken the next line's first word up (then this paragraph is narrower than its column, as in a table cell)
  const own = Math.max(...lines.map(l => l.x1)), lefts = new Set(lines.map(l => l.x0));
  const column = Math.max(own, ...lines.flatMap(l => pageLines(doc, l.p)).filter(t => [...lefts].some(x => Math.abs(t.x0 - x) < 1)).map(t => t.x1));
  const caps = lines.slice(0, -1).map((l, i) => { const next = wordsOf(lines[i + 1].shows.flatMap(x => x.glyphs), ps)[0]; return next ? l.x1 + ps * 0.2 + next[next.length - 1].x + next[next.length - 1].w - next[0].x : Infinity; });
  const right = Math.max(own, Math.min(column, Math.min(...caps) - 0.5));
  const pitches = lines.slice(1).map((l, i) => l.p === lines[i].p ? l.y - lines[i].y : null).filter(v => v > 0);
  const leading = med(pitches) ?? ps * 1.2;
  // each word keeps the style it had in the original (bold figures, an italic name, a coloured link); new words take the paragraph's
  const pool = new Map();
  for (const l of lines) for (const word of wordsOf(l.shows.flatMap(x => x.glyphs), ps)) {
    const t = word.map(g => g.u).join(''), c = {};
    for (const g of word) c[`${g.font}|${g.fill}`] = (c[`${g.font}|${g.fill}`] || 0) + 1;
    const [font, fill] = Object.entries(c).sort((a, b) => b[1] - a[1])[0][0].split('|');
    // and its letters' exact places (kerning): a word set again lands letter for letter where it was
    const shape = word.map(g => ({u: g.u, dx: g.x - word[0].x, w: g.w}));
    for (const key of new Set([t, t.replace(/[.,;:]+$/, '')])) { if (!pool.has(key)) pool.set(key, []); pool.get(key).push({font, fill, shape}); }
  }
  // the gap between words as the original sets it (LaTeX has no space glyph; Word and Docs stretch it)
  const space = glyphOf(' ');
  const gapsOf = l => { const ws = wordsOf(l.shows.flatMap(x => x.glyphs), ps); return ws.slice(1).map((w, i) => w[0].x - (ws[i][ws[i].length - 1].x + ws[i][ws[i].length - 1].w)); };
  const flush = lines.length >= 2 && lines.slice(0, -1).every(l => Math.abs(l.x1 - right) < 1.5);
  const fullGap = med(lines.slice(0, -1).flatMap(gapsOf)), lastGap = med(gapsOf(lines[lines.length - 1])) ?? (space ? adv(space) : null);
  const justified = flush && fullGap !== null && lastGap !== null && fullGap > lastGap * 1.12;
  // justified: the natural gap is the last line's (or the space glyph's when the last line is one word); ragged: every line's
  const measured = justified ? lastGap : med(lines.flatMap(gapsOf));
  const gap = measured ?? (space ? adv(space) : ps * 0.28);
  // how far the original squeezed its gaps on a full line to take one more word (TeX does, Word mostly doesn't): never further
  const tightest = justified ? Math.min(...lines.slice(0, -1).flatMap(gapsOf)) : gap;
  const squeeze = Math.max(0, Math.min(gap * 0.2, gap - tightest));
  // how tight the original sets letters (kerning, tracking): its word widths over plain glyph advances, spread as letter spacing
  let ink = 0, nat = 0, n = 0, sum = 0;
  for (const l of lines) for (const word of wordsOf(l.shows.flatMap(x => x.glyphs), ps)) {
    n += word.length; sum += word.reduce((t, g) => t + g.w, 0);
    if (word.length > 1) { ink += word[word.length - 1].x + word[word.length - 1].w - word[0].x; nat += word.reduce((t, g) => t + g.w, 0); }
  }
  const k = nat ? Math.min(1.1, Math.max(0.85, ink / nat)) : 1, tcExtra = (k - 1) * (n ? sum / n : 0);
  return {shows, lines, main, scale, ps, right, leading, justified, gap, squeeze, tcExtra, pool, glyphOf, adv, ligate, nameOf: key => fonts[key]?.name || '', space: space ? adv(space) : 0,
    x0: i => (i === 0 ? lines[0].x0 : cont.x0), box: box(lines, ps)};
}

// A page's printed lines (shows on one baseline, cut where a gap is wider than two letters), kept on the page object.
function pageLines(doc, p) {
  const page = doc.pages[p];
  if (page._lines) return page._lines;
  const out = [], shows = page.shows.filter(s => s.glyphs.some(inked)).sort((a, b) => a.y - b.y || a.x - b.x);
  for (const s of shows) {
    const line = out.find(l => Math.abs(l.y - s.y) < s.ps * 0.4 && s.x >= l.x0 - 0.5 && s.x - l.x1 < s.ps * 2);
    if (line) line.x1 = Math.max(line.x1, s.x1); else out.push({y: s.y, x0: s.x, x1: s.x1});
  }
  Object.defineProperty(page, '_lines', {value: out, enumerable: false});
  return out;
}

const box = (lines, ps) => lines.map(l => ({p: l.p, x: l.x0, y: l.y - ps * 0.85, w: l.x1 - l.x0, h: ps * 1.1}));

// New wording broken into the paragraph's lines. -> {lines: [[word]], missing: 'letters no font here has', missingBy: {font name: letters}, fits}
export function setWords(para, text, slots = para.lines.length) {
  const pool = new Map([...para.pool].map(([key, list]) => [key, [...list]]));
  const pick = t => {
    for (const key of [t, t.replace(/[.,;:]+$/, '')]) {
      const list = pool.get(key);
      if (!list?.length) continue;
      const {font, fill, shape} = list.shift(), chars = [...t];
      const fitted = shape.length >= chars.length && shape.slice(0, chars.length).every((g, i) => g.u === chars[i]) ? shape.slice(0, chars.length) : null;
      return {font, fill, shape: fitted};
    }
    return {font: para.main.font, fill: para.main.fill, shape: null};
  };
  const words = String(text).replace(/\*\*/g, '').trim().split(/\s+/).filter(Boolean).map(t => para.ligate(t)).map(t => ({t, ...pick(t)}));
  const missing = new Set(), by = {};
  const wordW = w => {
    const gls = [...w.t].map(ch => { const gl = para.glyphOf(ch, w.font); if (!gl) { missing.add(ch); (by[para.nameOf(w.font)] ??= new Set()).add(ch); } return gl; });
    if (w.shape && gls.every(Boolean)) return w.shape[w.shape.length - 1].dx + para.adv(gls[gls.length - 1]);
    w.shape = null;
    return gls.reduce((s, gl) => s + (gl ? para.adv(gl) + para.tcExtra : para.ps * 0.5), 0);
  };
  for (const w of words) w.w = wordW(w);
  const out = []; let cur = [];
  for (const w of words) {
    const trial = [...cur, w], width = trial.reduce((s, x) => s + x.w, 0) + para.gap * (trial.length - 1);
    // a justified paragraph may squeeze its gaps as far as the original did, to take one more word
    const room = para.right + (para.lines.length === 1 ? para.ps * 0.25 : 0.5) + para.squeeze * (trial.length - 1);
    if (cur.length && para.x0(out.length) + width > room) { out.push(cur); cur = [w]; } else cur = trial;
  }
  if (cur.length) out.push(cur);
  return {lines: out, missing: [...missing].join(''), missingBy: Object.fromEntries(Object.entries(by).map(([name, set]) => [name, [...set].join('')])),
    fits: out.length <= slots && !missing.size};
}

// One set line as a text operation for write.js: {p, x, y, size, m, th, tc, runs: [{font, fill, items: [{code | ch, adj}]}]}.
// adj: the TJ adjustment after the glyph, in thousandths of text space (negative moves right).
export function lineOp(para, words, {p, y, x, last}) {
  const {main, scale} = para, unit = 1000 / (main.size * scale * main.th);
  const natural = words.reduce((s, w) => s + w.w, 0) + para.gap * (words.length - 1);
  const extra = para.justified && !last && words.length > 1 ? (para.right - x - natural) / (words.length - 1) : 0;
  const runs = []; let run = null;
  const push = (key, fill, item) => { if (!run || run.font !== key || run.fill !== fill) runs.push(run = {font: key, fill, items: []}); run.items.push(item); };
  words.forEach((w, wi) => {
    if (wi) {
      const sp = para.glyphOf(' ', words[wi - 1].font), move = para.gap + extra - (sp ? para.adv(sp) + para.tcExtra : 0);
      if (sp) push(sp.key, words[wi - 1].fill, {code: sp.code, ch: sp.ch, adj: -move * unit});
      else if (run) run.items[run.items.length - 1].adj -= move * unit;
    }
    const chars = [...w.t];
    chars.forEach((ch, ci) => {
      const gl = para.glyphOf(ch, w.font) || para.glyphOf('?', w.font);
      if (!gl) return;
      const step = para.adv(gl) + para.tcExtra;   // what the glyph advances as written; a known word moves to its original places
      const adj = !w.shape ? 0 : ci < chars.length - 1 ? -(w.shape[ci + 1].dx - w.shape[ci].dx - step) * unit : para.tcExtra * unit;
      push(gl.key, w.fill, {code: gl.code, ch: gl.ch, adj});
    });
  });
  const m = main.rm.slice(0, 4).map(v => v / scale);
  return {p, x, y, size: main.size * scale, m, th: main.th, tc: main.tc * scale + para.tcExtra / main.th, runs,
    box: {p, x, y: y - para.ps * 0.85, w: natural + extra * Math.max(0, words.length - 1), h: para.ps * 1.1}};
}

// A show copied to a new place (a bullet marker moving with its bullet): same glyphs, same gaps between them.
export function copyShow(doc, p, k, to) {
  const s = doc.pages[p].shows[k], scale = Math.hypot(s.rm[0], s.rm[1]), unit = 1000 / (s.size * scale * s.th);
  const gs = s.glyphs.filter(g => g.code !== undefined);
  const items = gs.map((g, i) => ({code: g.code, adj: i < gs.length - 1 ? -(gs[i + 1].x - (g.x + g.w)) * unit : 0}));
  return {p: to.p, x: s.x, y: to.y, size: s.size * scale, m: s.rm.slice(0, 4).map(v => v / scale), th: s.th, tc: s.tc * scale,
    runs: [{font: s.font, fill: s.fill, items}], box: null};
}

// Re-sets one item on its own lines. -> {remove: [{p, k}], add: [lineOp], fits, missing, para}; fits false = the original stays.
export function resetItem(doc, shows, text) {
  const para = measure(doc, shows), set = setWords(para, text);
  if (!set.fits) return {remove: [], add: [], fits: false, missing: set.missing, missingBy: set.missingBy, para, lines: set.lines.length};
  const add = set.lines.map((ws, i) => lineOp(para, ws, {p: para.lines[i].p, y: para.lines[i].y, x: para.x0(i), last: i === set.lines.length - 1}));
  return {remove: shows, add, fits: true, missing: '', para, lines: set.lines.length};
}
