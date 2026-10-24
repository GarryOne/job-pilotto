// What a PDF's pages say, as pdf.js reads them: every page-level text-show operator in stream order with its glyphs (unicode, code, advance,
// position), font, size, spacing and colour, plus the small filled shapes (vector bullet markers). Plain data, so it can come back from the
// hidden window that runs pdf.js in the app (cv/pdf-probe.html) as well as from Node in the tests. Positions are points from the page's top left.
// Guards: test/pdf-edit.test.js, test/cv-inplace.test.js.
const mul = (a, b) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
const six = m => Array.isArray(m) ? m : [0, 1, 2, 3, 4, 5].map(k => m[k]);
const hex = a => typeof a === 'string' ? a : '#' + [...a].slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

// pdfjs: the pdf.js module (the app's renderer build or Node's legacy build). -> {pages: [{n, x0, y0, width, height, shows, marks}], fonts}
// (x0, y0: the page box's corner in user space, to turn positions back into PDF coordinates)
export async function readPdf(pdfjs, bytes) {
  const O = pdfjs.OPS;
  const task = pdfjs.getDocument({data: new Uint8Array(bytes), verbosity: 0, fontExtraProperties: true, isEvalSupported: false}), doc = await task.promise;
  const pages = [], fonts = {};
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n), [x0, y0, x1, y1] = page.view, H = y1 - y0;
      const list = await page.getOperatorList(), shows = [], marks = [];
      let g = {ctm: [1, 0, 0, 1, -x0, -y0], font: null, size: 0, tc: 0, tw: 0, th: 1, tl: 0, rise: 0, fill: '#000000'};
      const stack = []; let tm = [1, 0, 0, 1, 0, 0], tlm = tm, form = 0;
      const move = (x, y) => { tlm = mul([1, 0, 0, 1, x, y], tlm); tm = tlm; };
      list.fnArray.forEach((fn, i) => {
        const a = list.argsArray[i];
        switch (fn) {
          case O.save: stack.push({...g}); break;
          case O.restore: g = stack.pop() || g; break;
          case O.transform: g.ctm = mul(a, g.ctm); break;
          case O.paintFormXObjectBegin: form++; stack.push({...g}); if (a[0]) g.ctm = mul(six(a[0]), g.ctm); break;
          case O.paintFormXObjectEnd: form--; g = stack.pop() || g; break;
          case O.beginText: tm = tlm = [1, 0, 0, 1, 0, 0]; break;
          case O.setFont: g.font = a[0]; g.size = a[1]; break;
          case O.setTextMatrix: tm = tlm = six(a[0]); break;
          case O.moveText: move(a[0], a[1]); break;
          case O.setLeadingMoveText: g.tl = -a[1]; move(a[0], a[1]); break;
          case O.nextLine: move(0, -g.tl); break;
          case O.setLeading: g.tl = a[0]; break;
          case O.setCharSpacing: g.tc = a[0]; break;
          case O.setWordSpacing: g.tw = a[0]; break;
          case O.setHScale: g.th = a[0] / 100; break;
          case O.setTextRise: g.rise = a[0]; break;
          case O.setFillRGBColor: g.fill = hex(a[0] ?? a); break;
          case O.setFillGray: g.fill = hex([a[0] * 255, a[0] * 255, a[0] * 255]); break;
          case O.constructPath: {
            if (form || ![O.fill, O.eoFill, O.fillStroke, O.eoFillStroke].includes(a[0]) || !a[2]) break;
            const m = Array.from(a[2]), p = [[m[0], m[1]], [m[2], m[3]], [m[0], m[3]], [m[2], m[1]]].map(([x, y]) => mul([1, 0, 0, 1, x, y], g.ctm));
            const xs = p.map(q => q[4]), ys = p.map(q => H - q[5]);
            const box = {x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), fill: g.fill};
            if (box.w > 0.5 && box.w < 9 && box.h > 0.5 && box.h < 9) marks.push(box);
            break;
          }
          case O.showText: {
            if (!fonts[g.font]) {
              let font = {}; try { font = page.commonObjs.get(g.font) || {}; } catch {}
              fonts[g.font] = {name: String(font.name || '').replace(/^[A-Z]{6}\+/, ''), fm: Array.from(font.fontMatrix || [0.001, 0, 0, 0.001, 0, 0]), type3: !!font.isType3Font,
                vertical: !!font.vertical, glyphs: {}};
            }
            const f = fonts[g.font], rm = mul(tm, g.ctm), scale = Math.hypot(rm[0], rm[1]);
            const start = mul([1, 0, 0, 1, 0, g.rise], rm), glyphs = [];
            let tx = 0;
            for (const glyph of a[0]) {
              if (typeof glyph === 'number') { tx += -glyph / 1000 * g.size * g.th; continue; }
              if (!glyph) continue;
              const w = (glyph.width * f.fm[0] * g.size + g.tc + (glyph.isSpace ? g.tw : 0)) * g.th;
              const p = mul([1, 0, 0, 1, tx, g.rise], rm);
              glyphs.push({u: glyph.unicode || '', code: glyph.originalCharCode, x: p[4], y: H - p[5], w: w * scale, font: g.font, fill: g.fill});
              if (glyph.unicode && !f.glyphs[glyph.unicode]) f.glyphs[glyph.unicode] = {code: glyph.originalCharCode, width: glyph.width};
              tx += w;
            }
            const end = mul([1, 0, 0, 1, tx, g.rise], rm);
            if (!form) shows.push({font: g.font, size: g.size, ps: Math.abs(g.size) * scale, th: g.th, tc: g.tc, tw: g.tw, fill: g.fill, rm, x: start[4], y: H - start[5], x1: end[4], tx, glyphs});
            tm = mul([1, 0, 0, 1, tx, 0], tm);
            break;
          }
        }
      });
      pages.push({n, x0, y0, width: x1 - x0, height: H, shows, marks});
    }
  } finally { await task.destroy(); }
  return {pages, fonts};
}
