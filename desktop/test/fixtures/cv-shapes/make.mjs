// Makes the made-up CV look-alikes the in-place tailoring is tested on (lib/cv-inplace.js; test/cv-inplace.test.js). Run by hand, once:
//   npx electron test/fixtures/cv-shapes/make.mjs <folder with Carlito-Regular/Bold/Italic.ttf>
// CV_SHAPES=french,band makes only those (the others stay byte for byte).
// The four HTML shapes are printed by Chromium like the app prints (CID TrueType from Carlito, Type 3 from the variable Inter); the two
// others are drawn by make-drawn.mjs. All people are invented. The PDFs are committed; this only remakes them.
import {app, BrowserWindow} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {wordLike, latexLike} from './make-drawn.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const carlito = path.resolve(process.argv[process.argv.length - 1]);
const inter = path.join(here, '..', '..', '..', 'cv', 'fonts');

async function printHtml(name) {
  const html = fs.readFileSync(path.join(here, `${name}.html`), 'utf8')
    .replaceAll('url(CARLITO/', `url(${pathToFileURL(carlito).href}/`).replaceAll('url(INTER/', `url(${pathToFileURL(inter).href}/`);
  const temp = path.join(app.getPath('temp'), `cv-shape-${name}.html`);
  fs.writeFileSync(temp, html);
  const win = new BrowserWindow({show: false, width: 794, height: 1123, webPreferences: {sandbox: false}});
  try {
    await win.loadFile(temp);
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => 1)');
    return await win.webContents.printToPDF({pageSize: 'A4', printBackground: true, preferCSSPageSize: true, margins: {marginType: 'none'}});
  } finally { win.destroy(); fs.rmSync(temp, {force: true}); }
}

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  try {
    const only = (process.env.CV_SHAPES || '').split(',').filter(Boolean), wanted = name => !only.length || only.includes(name);
    for (const name of ['sidebar', 'band', 'table', 'french'].filter(wanted)) fs.writeFileSync(path.join(here, `${name}.pdf`), await printHtml(name));
    if (wanted('word-like')) fs.writeFileSync(path.join(here, 'word-like.pdf'), await wordLike());
    if (wanted('latex-like')) fs.writeFileSync(path.join(here, 'latex-like.pdf'), await latexLike());
    console.log(`made ${only.length ? only.join(', ') : 'the 6 CV shapes'}`);
  } catch (error) { console.error(`cv shapes not made: ${error.message}`); process.exitCode = 1; }
  app.quit();
});
