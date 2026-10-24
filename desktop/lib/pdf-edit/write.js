// Writes a plan from layout.js into the PDF with pdf-lib: the edited show operators become bare advances ([-n] TJ, so the rest of their line
// stays put), moved vector markers leave their place, and the new lines are appended in the same fonts. Every other byte of the page stays.
// The page's stream is wrapped in q … Q so the appended text starts from a clean state. Guards: test/pdf-edit.test.js, test/cv-inplace.test.js.
import {PDFDocument, PDFName, PDFArray, PDFDict, PDFRef, decodePDFRawStream} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {lex, SHOW} from './lex.js';

const mul = (a, b) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
const PATH = new Set(['m', 'l', 'c', 'v', 'y', 'h', 're']);
const FILL = new Set(['f', 'F', 'f*', 'B', 'B*', 'b', 'b*']);
const n = v => (Math.abs(v) < 1e-9 ? 0 : v).toFixed(4).replace(/\.?0+$/, '') || '0';
const rgb = hex => [1, 3, 5].map(i => n(parseInt(hex.slice(i, i + 2), 16) / 255)).join(' ');

// The page's content stream(s), decoded and joined.
function contentOf(pdf, page) {
  const contents = page.node.Contents();
  if (!contents) return new Uint8Array(0);
  const streams = contents instanceof PDFArray ? contents.asArray().map(ref => pdf.context.lookup(ref)) : [contents];
  const parts = streams.map(stream => decodePDFRawStream(stream).decode());
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length + 1, 0));
  let at = 0; for (const p of parts) { out.set(p, at); at += p.length; out[at++] = 10; }
  return out;
}

// One page's operators with, for each show, the font resource in force, and each filled path's box (top-left points).
function scan(bytes, info) {
  const ops = lex(bytes), shows = [], paths = [], stack = [];
  let tf = null, ctm = [1, 0, 0, 1, 0, 0], path = null;
  for (const op of ops) {
    const num = op.operands.map(o => o.num);
    if (op.op === 'q') stack.push({tf, ctm}); else if (op.op === 'Q') ({tf, ctm} = stack.pop() || {tf, ctm});
    else if (op.op === 'cm' && num.length === 6) ctm = mul(num, ctm);
    else if (op.op === 'Tf') tf = op.operands[0]?.name;
    else if (SHOW.has(op.op)) shows.push({op, tf});
    else if (PATH.has(op.op)) {
      if (!path) path = {start: op.start, pts: [], ctm};
      const xy = op.op === 're' ? [num[0], num[1], num[0] + num[2], num[1] + num[3]] : num;
      for (let i = 0; i + 1 < xy.length; i += 2) { const p = mul([1, 0, 0, 1, xy[i], xy[i + 1]], ctm); path.pts.push([p[4] - info.x0, info.height - (p[5] - info.y0)]); }
    } else if (path) {
      if (FILL.has(op.op) && path.pts.length) {
        const xs = path.pts.map(p => p[0]), ys = path.pts.map(p => p[1]);
        paths.push({start: path.start, end: op.end, body: op.start, paint: op.op, ctm: path.ctm, x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys)});
      }
      path = null;
    }
  }
  return {ops, shows, paths};
}

// bytes: the original PDF. doc: what read.js returned for it. plan: {remove: [{p, k}], add: [lineOp], marks: [{p, i, to: {p, dy}}]}.
// embeds: {key: font bytes} for letters taken from a font that isn't in the file (fonts.js). -> the edited PDF's bytes.
// Throws when the file can't be edited safely (the caller then uses the template).
export async function writePdf(bytes, doc, plan, {embeds = {}} = {}) {
  const pdf = await PDFDocument.load(bytes, {updateMetadata: false});
  const pages = pdf.getPages();
  if (pages.length !== doc.pages.length) throw new Error('page count differs from the read');
  const contents = pages.map(page => contentOf(pdf, page));
  const scans = contents.map((c, p) => scan(c, doc.pages[p]));
  // each font key's resource name and dictionary, from the page that uses it
  const fontRes = {};
  scans.forEach(({shows}, p) => {
    if (shows.length !== doc.pages[p].shows.length) throw new Error(`page ${p + 1}: ${shows.length} show operators, pdf.js read ${doc.pages[p].shows.length}`);
    const dict = pages[p].node.Resources()?.lookup(PDFName.of('Font'), PDFDict);
    shows.forEach((s, k) => {
      const key = doc.pages[p].shows[k].font;
      if (fontRes[key] || !s.tf || !dict) return;
      const raw = dict.get(PDFName.of(s.tf)), font = dict.lookup(PDFName.of(s.tf));
      fontRes[key] = {p, res: s.tf, ref: raw instanceof PDFRef ? raw : null, type0: String(font?.get?.(PDFName.of('Subtype'))) === '/Type0'};
    });
  });
  if (Object.keys(embeds).length) pdf.registerFontkit(fontkit);
  const embedded = {};
  for (const [key, data] of Object.entries(embeds)) embedded[key] = await pdf.embedFont(data, {subset: true});

  const touched = new Set([...plan.remove.map(r => r.p), ...plan.add.map(a => a.p), ...(plan.marks || []).flatMap(m => [m.p, m.to.p])]);
  for (const p of [...touched].sort((a, b) => a - b)) {
    const page = pages[p], info = doc.pages[p], {shows, paths} = scans[p], src = contents[p];
    page.node.normalize();
    // the resource name of a font on this page (added to its Font dictionary when it only lived on another page)
    const names = new Map();
    const resOf = key => {
      if (names.has(key)) return names.get(key);
      const f = fontRes[key], ref = embedded[key]?.ref ?? f?.ref;
      if (!embedded[key] && !f) throw new Error(`no resource for font ${key}`);
      const here = shows.find((sh, k) => sh.tf && info.shows[k].font === key);
      if (!embedded[key] && here) return here.tf;
      if (!ref) throw new Error(`font ${key} is not shared between pages`);
      const name = page.node.newFontDictionary(embedded[key]?.name || f.res, ref).toString().slice(1);
      names.set(key, name);
      return name;
    };
    const cuts = [];
    for (const {k} of plan.remove.filter(r => r.p === p)) {
      const s = info.shows[k], op = shows[k].op;
      const keep = op.op === "'" ? 'T* ' : op.op === '"' ? `${op.operands[0].num} Tw ${op.operands[1].num} Tc T* ` : '';
      cuts.push({start: op.start, end: op.end, text: `${keep}[${n(-(s.tx / (s.size * s.th)) * 1000)}] TJ`});
    }
    for (const m of (plan.marks || []).filter(x => x.p === p)) cuts.push({...pathOf(paths, info.marks[m.i]), text: ''});
    cuts.sort((a, b) => a.start - b.start);
    let text = '', last = 0;
    for (const c of cuts) { if (c.start < last) throw new Error('overlapping edits'); text += Buffer.from(src.subarray(last, c.start)).toString('latin1') + c.text; last = c.end; }
    text += Buffer.from(src.subarray(last)).toString('latin1');

    let fresh = '';
    for (const m of (plan.marks || []).filter(x => x.to.p === p)) {   // a vector marker drawn again where its bullet now starts
      const from = doc.pages[m.p], path = pathOf(scans[m.p].paths, from.marks[m.i]), body = Buffer.from(contents[m.p].subarray(path.start, path.body)).toString('latin1');
      const dx = info.x0 - from.x0, dy = (info.height + info.y0) - (from.height + from.y0) - m.to.dy;
      fresh += `q 1 0 0 1 ${n(dx)} ${n(dy)} cm ${path.ctm.map(n).join(' ')} cm ${rgb(from.marks[m.i].fill)} rg ${body} ${path.paint} Q\n`;
    }
    for (const line of plan.add.filter(a => a.p === p)) {
      fresh += `BT ${n(line.th * 100)} Tz ${n(line.tc)} Tc 0 Tw ${line.m.map(n).join(' ')} ${n(line.x + info.x0)} ${n(info.height - line.y + info.y0)} Tm `;
      for (const run of line.runs) {
        const font = embedded[run.font], wide = fontRes[run.font]?.type0;
        const glyph = it => font ? font.encodeText(it.ch).toString() : `<${it.code.toString(16).padStart(wide ? 4 : 2, '0')}>`;
        const pieces = run.items.map(it => glyph(it) + (Math.abs(it.adj) > 0.005 ? ` ${n(it.adj)} ` : ''));
        fresh += `${rgb(run.fill)} rg /${resOf(run.font)} ${n(line.size)} Tf [${pieces.join('')}] TJ `;
      }
      fresh += 'ET\n';
    }
    page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.flateStream(Buffer.from(`q\n${text}\nQ\n${fresh}`, 'latin1'))));
  }
  return pdf.save({useObjectStreams: false});
}

function pathOf(paths, mark) {
  const found = paths.find(p => Math.abs(p.x - mark.x) < 0.6 && Math.abs(p.y - mark.y) < 0.6 && Math.abs(p.w - mark.w) < 0.6 && Math.abs(p.h - mark.h) < 0.6);
  if (!found) throw new Error('a marker could not be found in the page stream');
  return found;
}
