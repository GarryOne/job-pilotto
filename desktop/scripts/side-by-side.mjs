// One side-by-side preview for the owner before a UI PR: reference | render, both scaled to one column width, labelled (docs/rules/desktop-ui.md).
//   npm run side-by-side -- <reference.png> <render.png> --out <file.png> [--left "Mockup 03"] [--right "Our render (demo data)"] [--width 1400]
// Light and dark are two runs. Layout from session d5's side.py (18 Oct 2026); drawn in an offscreen Electron window, so it needs nothing beyond desktop/.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {previewPath, sessionShortName} from './preview-name.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => { const at = args.indexOf(`--${name}`); return at >= 0 ? args[at + 1] : fallback; };
const files = args.filter((arg, i) => !arg.startsWith('--') && !args[i - 1]?.startsWith('--'));
const [left, right] = files;
const given = option('out', '');
if (!left || !right || !given) {
  console.error('usage: npm run side-by-side -- <reference.png> <render.png> --out <file.png> [--left <label>] [--right <label>] [--width <px>]');
  process.exit(2);
}
for (const file of [left, right]) if (!fs.existsSync(file)) { console.error(`side-by-side: no such image: ${file}`); process.exit(2); }

// The file name starts with the session's short name (the owner sees whose preview is open); decided once, here, and the Electron run gets the final path.
const named = process.versions.electron ? {path: given, named: true} : previewPath(given, sessionShortName());
const out = named.path;
if (!named.named) console.error('side-by-side: session name unknown; wrote the file under the name given');

if (!process.versions.electron) {
  // From npm: start Electron on this same file; it draws and exits.
  const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const electron = path.join(desktop, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
  const run = spawnSync(electron, [fileURLToPath(import.meta.url), ...args.map(arg => arg === given ? out : arg)], {stdio: 'inherit', env: {...process.env, ELECTRON_RUN_AS_NODE: ''}});
  process.exit(run.status ?? 1);
}

const {app, BrowserWindow, nativeImage} = await import('electron');
const width = Number(option('width', '1400'));
const label = 54, gap = 40;
// Images by file:// link from a page in a temp folder: a full-page PNG as a data: URL is past Chromium's URL limit (ERR_INVALID_URL, 18 Oct 2026).
const sized = file => { const image = nativeImage.createFromPath(path.resolve(file)); const {width: w, height: h} = image.getSize(); return {url: pathToFileURL(path.resolve(file)).href, height: Math.round(h * width / w)}; };
const escape = text => String(text).replace(/[&<>"]/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[ch]);

app.whenReady().then(async () => {
  try {
  const a = sized(left), b = sized(right);
  const total = {width: width * 2 + gap, height: Math.max(a.height, b.height) + label};
  const column = (image, words) => `<div class="col"><div class="label">${escape(words)}</div><img src="${image.url}" style="height:${image.height}px"></div>`;
  const html = `<!doctype html><meta charset="utf-8"><style>
    html, body { margin: 0; background: #282830; }
    .row { display: flex; gap: ${gap}px; width: ${total.width}px; }
    .col { width: ${width}px; }
    .label { height: ${label}px; line-height: ${label}px; padding-left: 10px; color: #fff; font: 600 28px -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; }
    img { display: block; width: ${width}px; }
  </style><div class="row">${column(a, option('left', 'Reference'))}${column(b, option('right', 'Our render (demo data)'))}</div>`;
  const win = new BrowserWindow({show: false, width: total.width, height: total.height, useContentSize: true, webPreferences: {offscreen: true}});
  const page = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'side-by-side-')), 'page.html');
  fs.writeFileSync(page, html);
  await win.loadFile(page);
  await new Promise(resolve => setTimeout(resolve, 300));
  const picture = await win.webContents.capturePage({x: 0, y: 0, width: total.width, height: total.height});
  fs.mkdirSync(path.dirname(path.resolve(out)), {recursive: true});
  fs.writeFileSync(out, picture.toPNG());
  console.log(`side-by-side: ${path.resolve(out)} (${total.width}×${total.height}); open it for the owner and ask ship / change`);
  app.exit(0);
  } catch (error) { console.error(`side-by-side: ${error.message}`); app.exit(1); }
});
