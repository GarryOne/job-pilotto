// Keeps the look of the person's own CV PDF: where its photo, contact icons, employer logos, bottom banner and page breaks sit, cut out of
// the PDF (cv/pdf-probe.html reads it with pdf.js) and written to cv/assets/ + cv.json, so the template (cv/template.js) draws the same page.
// `plan` is pure (positions in, decisions out) and tested; `probeWindow` is the Electron side; `apply` writes the assets.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const median = list => { const sorted = [...list].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0; };
const same = (a, b) => ['x', 'y', 'w', 'h'].every(key => Math.abs(a[key] - b[key]) < 0.5);
const norm = text => String(text || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^(mailto|tel):/, '').replace(/\s+/g, '');

// pages: what cv/pdf-probe.html's scan() returns. cv: the transcribed CV (links, jobs). -> what to cut and where it goes.
export function plan(pages, cv) {
  const first = pages[0];
  if (!first) return {};
  const W = first.width, H = first.height;
  const images = pages.map(page => {
    const kept = [];
    for (const image of page.images) {
      if (image.w <= 2 || image.h <= 2) continue;
      const twin = kept.find(other => same(other, image));   // an image and its mask are painted twice at one place
      if (twin) twin.ids.push(image.id); else kept.push({...image, ids: [image.id]});
    }
    return kept;
  });
  const summary = first.text.find(item => /^summary$/i.test(item.str.trim()));
  const headerBottom = summary ? summary.y : H * 0.3;
  const inHeader = image => image.y + image.h < headerBottom + 4;
  const result = {width: W, height: H, icons: [], logos: [], pages: pages.map(() => ({}))};

  const banner = images.flatMap((list, n) => list.map(image => ({...image, page: n + 1}))).find(image => image.w >= W * 0.9);
  if (banner) { result.banner = banner; result.pages[banner.page - 1].banner = true; }
  const photo = images[0].find(image => image !== banner && inHeader(image) && image.x > W / 2 && image.w >= 20 && image.w <= 110 && Math.abs(image.w - image.h) < image.w * 0.2);
  if (photo) result.photo = {...photo, page: 1};

  // Contact icons: the square just left of each link's text, in the size and gap the original uses.
  const rasterIcons = images[0].filter(image => image !== photo && image !== banner && inHeader(image) && image.w <= 30);
  const size = median(rasterIcons.map(image => image.w)) || 15;
  const placed = first.text.filter(item => item.y < headerBottom);
  (cv.links || []).forEach((link, i) => {
    const wanted = norm(link.text).slice(0, 12);
    const item = wanted && placed.find(candidate => norm(candidate.str).startsWith(wanted) || (norm(candidate.str).length > 4 && norm(link.text).startsWith(norm(candidate.str))));
    if (!item) return;
    const mid = item.y + item.h / 2;
    const near = rasterIcons.filter(icon => Math.abs(icon.y + icon.h / 2 - mid) < 6 && icon.x + icon.w <= item.x + 1)
      .sort((a, b) => (b.x + b.w) - (a.x + a.w))[0];   // the nearest one to the left, not the first in the row
    const gap = near && item.x - (near.x + near.w) < 15 ? Math.max(1, item.x - (near.x + near.w)) : 5;
    result.icons.push({link: i, page: 1, x: item.x - gap - size, y: mid - size / 2, w: size, h: size});
  });

  // The header's links read down each column (the template's grid fills a column before the next): order them as the original lays them out.
  const spots = [];
  (cv.links || []).forEach((link, i) => { const icon = result.icons.find(entry => entry.link === i); if (icon) spots.push({i, x: icon.x, y: icon.y}); });
  spots.sort((a, b) => a.x - b.x);
  const columns = [];
  for (const spot of spots) { const column = columns[columns.length - 1]; if (column && spot.x - column[0].x < 40) column.push(spot); else columns.push([spot]); }
  const order = columns.flatMap(column => column.sort((a, b) => a.y - b.y)).map(spot => spot.i);
  if (order.length === (cv.links || []).length) result.linkOrder = order;

  // Page of each employer: where its name stands alone (the title row repeats it, bullets only contain it).
  const jobPages = (cv.jobs || []).map(job => {
    const name = String(job.company || '').trim().toLowerCase();
    for (const [n, page] of pages.entries()) {
      const item = page.text.find(candidate => candidate.str.trim().toLowerCase() === name && candidate.y > headerBottom * (n ? 0 : 1));
      if (item) return {page: n, item};
    }
    return null;
  });
  if (jobPages.length && jobPages.every(Boolean)) {
    result.jobPages = jobPages.map(entry => entry.page);
    // Logos: small images at the left edge, the one level with an employer's name on its page.
    const small = images.flatMap((list, n) => list.map(image => ({...image, page: n + 1})))
      .filter(image => image !== banner && !(image.page === 1 && inHeader(image)) && image.w >= 6 && image.w <= 70 && image.h <= 40 && image.x < 70);
    const used = new Set();
    (cv.jobs || []).forEach((job, i) => {
      const {page, item} = jobPages[i], mid = item.y + item.h / 2;
      const logo = small.filter(image => image.page === page + 1 && !used.has(image) && Math.abs(image.y + image.h / 2 - mid) <= 22)
        .sort((a, b) => Math.abs(a.y + a.h / 2 - mid) - Math.abs(b.y + b.h / 2 - mid))[0];
      if (logo) {
        used.add(logo);
        // The CV may clip a wide logo to its mark: what shows ends where the title's text starts.
        const next = pages[logo.page - 1].text.filter(text => text.x > logo.x + 3 && text.y < logo.y + logo.h && text.y + text.h > logo.y).map(text => text.x);
        const visible = next.length ? Math.min(logo.w, Math.min(...next) - logo.x - 1) : logo.w;
        result.logos.push({job: i, ...logo, fraction: Math.max(0.1, Math.min(1, visible / logo.w))});
      }
    });
    // Page margins: logos set in from the margin shift the whole page's jobs; one that stays out is an outdent.
    const margin = Math.min(...first.text.map(item => item.x), ...(result.logos.map(logo => logo.x)));
    result.margin = margin;
    for (const [n] of pages.entries()) {
      const xs = result.logos.filter(logo => logo.page === n + 1).map(logo => Math.round(logo.x));
      const modal = median(xs);
      const indent = xs.length ? Math.round(modal - margin) : 0;
      if (indent > 5) result.pages[n].indent = indent;
    }
    for (const logo of result.logos) {
      const indent = result.pages[logo.page - 1].indent || 0;
      if (indent && logo.x - margin < indent - 5) result.logos.find(entry => entry === logo).outdent = Math.round(indent - (logo.x - margin));
    }
  }
  return result;
}

// Cuts the planned pieces out of the PDF (probe = {crop(page, x, y, w, h, trim)}), writes them to cv/assets/ and records them in the CV data.
export async function apply(dir, cv, found, probe) {
  const assets = path.join(dir, 'assets');
  fs.mkdirSync(assets, {recursive: true});
  const keep = async (name, piece, trim = false) => {
    const {png} = piece.ids?.length ? await probe.image(piece.page, piece.ids, piece.fraction || 1) : await probe.crop(piece.page, piece.x, piece.y, piece.w, piece.h, trim);
    fs.writeFileSync(path.join(assets, name), Buffer.from(png, 'base64'));
    return name;
  };
  const out = structuredClone(cv);
  // Links in the original's column order; the icons found for them follow.
  if (found.linkOrder) {
    out.links = found.linkOrder.map(i => cv.links[i]);
    found = {...found, icons: (found.icons || []).map(icon => ({...icon, link: found.linkOrder.indexOf(icon.link)}))};
  }
  if (found.photo) out.photo = await keep('photo.png', found.photo);
  for (const icon of found.icons || []) out.links[icon.link].icon = await keep(`icon-${icon.link}.png`, icon);
  for (const logo of found.logos || []) {
    out.jobs[logo.job].logo = await keep(`logo-${logo.job}.png`, logo, true);
    if (logo.outdent) out.jobs[logo.job].outdent = logo.outdent;
  }
  const pages = (found.pages || []).map((page, n) => ({...(n === 0 ? {class: 'first'} : {}), ...(page.indent ? {indent: page.indent} : {}),
    ...(page.banner ? {banner: 'banner.png'} : {})}));
  if (found.banner) await keep('banner.png', found.banner);
  if (found.jobPages && pages.length > 1 || found.banner) {
    out.layout = {pages};
    (found.jobPages || []).forEach((page, i) => { out.jobs[i].page = page; });
  }
  if (out.photo || (found.icons || []).length || (found.logos || []).length || found.banner) out.look = 'rich';
  return out;
}

// The hidden window that runs cv/pdf-probe.html on a PDF. -> {scan, crop, page, close}
export async function probeWindow(BrowserWindow, pdfPath) {
  const win = new BrowserWindow({show: false, width: 800, height: 600, webPreferences: {sandbox: false, contextIsolation: false, webSecurity: false}});
  await win.loadFile(path.join(here, '..', 'cv', 'pdf-probe.html'));
  for (let i = 0; i < 100 && !(await win.webContents.executeJavaScript('window.cvProbeReady === true')); i++) await new Promise(resolve => setTimeout(resolve, 100));
  const call = (name, ...args) => win.webContents.executeJavaScript(`window.cvProbe.${name}(...${JSON.stringify(args)})`);
  await call('open', fs.readFileSync(pdfPath).toString('base64'));
  return {open: base64 => call('open', base64), scan: () => call('scan'), crop: (...args) => call('crop', ...args), image: (...args) => call('image', ...args), page: (...args) => call('page', ...args), close: () => win.destroy()};
}
