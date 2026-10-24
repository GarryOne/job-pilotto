// The review of an in-place tailored CV: the real tailored pages (pictures drawn at tailoring time) with each changed line boxed in the
// colour of its change (reworded, moved up); hovering a box shows the wording before. lib/cv.js reviewPage adds the same panel as for the template CV (Final CV, changes and why,
// warnings, Hide highlights). Guards: test/cv-inplace-run.test.js.
const KIND = {reworded: 'k-rew', moved: 'k-mov', added: 'k-ins'};

// record.inPlace: {pages: [{width, height}], boxes: [{p, x, y, w, h, mark}]}; images: a file URL per page. -> an HTML document
export function pagesDocument(record, images) {
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const pages = record.inPlace.pages.map((page, p) => {
    const marks = record.inPlace.boxes.filter(b => b.p === p).map(b => `<div class="ip-mark ${KIND[b.mark] || 'k-rew'}" title="${esc(b.mark === 'moved' && b.before ? 'Moved up' : 'Before')}: ${esc(b.before || '')}" style="left:${(b.x - 1).toFixed(1)}pt;top:${(b.y - 1).toFixed(1)}pt;width:${(b.w + 2).toFixed(1)}pt;height:${(b.h + 2).toFixed(1)}pt"></div>`).join('');
    return `<div class="page fixed ip-page" style="width:${page.width.toFixed(1)}pt;height:${page.height.toFixed(1)}pt"><img src="${esc(images[p])}" alt="Page ${p + 1}">${marks}</div>`;
  }).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(record.job?.title)}</title><style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    .ip-page { position: relative; overflow: hidden; } .ip-page img { width: 100%; height: 100%; display: block; }
    .ip-mark { position: absolute; border-radius: 2pt; mix-blend-mode: multiply; }
    body.clean .ip-mark { display: none; }</style></head><body class="review">
${pages}
</body></html>`;
}
