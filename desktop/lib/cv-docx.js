// A Word CV picked by the person: kept as cv/cv.docx (Tailor edits it in place, lib/docx/edit.js) and drawn to cv.pdf, which every other
// part reads as today. The PDF comes from LibreOffice when the add-on is there (lib/office-addon.js, downloaded on first use), else from the
// app's own renderer (cv/docx-render.html); when LibreOffice arrives later, the PDF is drawn again. cv/docx.json names the PDF the .docx was
// drawn as: the .docx counts only while cv.pdf is still that PDF, so a PDF picked later (any path) leaves it unused.
// Guard: test/cv-docx.test.js.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as cvlib from './cv.js';
import {facesFor, familiesOf} from './docx/fonts.js';
import {readDocx} from './docx/zip.js';
import {log} from './log.js';
import {officePdf} from './office.js';
import {writePrivate} from './private-file.js';

export const isDocx = file => /\.docx$/i.test(String(file));
const docxFile = storage => path.join(cvlib.dir(storage), 'cv.docx');
const linkFile = storage => path.join(cvlib.dir(storage), 'docx.json');
const link = storage => { try { return JSON.parse(fs.readFileSync(linkFile(storage), 'utf8')); } catch { return null; } };

// The person's Word CV, when the current cv.pdf was drawn from it. -> path or null
export function currentDocx(storage) {
  const file = docxFile(storage), linked = link(storage);
  return linked && fs.existsSync(file) && linked.pdf === cvlib.pdfHash(storage) ? file : null;
}

// A Word file -> {pdf, by: 'libreoffice' | 'app'}. LibreOffice failing falls back to the app's renderer.
export async function drawDocx(storage, bytes, {soffice = null, renderDocx, faces = families => facesFor(families, {cacheDir: storage.path('fonts')}), convert = officePdf}) {
  if (soffice) {
    try { return {pdf: await convert(soffice, bytes, {profile: storage.path('office-profile')}), by: 'libreoffice'}; } catch (error) { log('cv', 'LibreOffice could not draw the Word CV', {error: String(error.message).slice(0, 200)}); }
  }
  const {zip} = await readDocx(bytes);
  return {pdf: (await renderDocx(bytes, await faces(await familiesOf(zip)))).pdf, by: 'app'};
}

// Picked: keep the .docx, draw its PDF and set that as the CV (setCv(file, name): lib/cv-import-at-upload.js setCv with its options), then get LibreOffice in the background
// and draw it again with it. -> what setCv returns, plus {by}
export async function setDocxCv(storage, file, name, {office, renderDocx, setCv, faces, convert}) {
  const bytes = fs.readFileSync(file);
  const {pdf, by} = await drawDocx(storage, bytes, {soffice: office.soffice(), renderDocx, faces, convert});
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-cv-docx-')), drawn = path.join(temp, 'cv.pdf');
  try {
    fs.writeFileSync(drawn, pdf);
    fs.mkdirSync(cvlib.dir(storage), {recursive: true});
    writePrivate(docxFile(storage), bytes);
    const set = setCv(drawn, name);
    writePrivate(linkFile(storage), JSON.stringify({pdf: cvlib.pdfHash(storage), by}) + '\n');
    // After the CV's background read (set.done), so the read mark it writes is the one redraw moves.
    if (by === 'app') set.redrawn = Promise.all([office.start(), set.done]).then(([soffice]) => (soffice ? redraw(storage, {soffice, renderDocx, faces, convert}) : false));
    return {...set, by};
  } finally { fs.rmSync(temp, {recursive: true, force: true}); }
}

// LibreOffice is here: the current Word CV's PDF drawn again with it. The CV was already read (same words), so its read mark moves to
// the new PDF instead of reading it again. -> true when redrawn
export async function redraw(storage, {soffice, renderDocx, faces, convert}) {
  const file = currentDocx(storage);
  if (!file || link(storage)?.by === 'libreoffice') return false;
  const before = cvlib.pdfHash(storage), {pdf, by} = await drawDocx(storage, fs.readFileSync(file), {soffice, renderDocx, faces, convert});
  if (by !== 'libreoffice' || cvlib.pdfHash(storage) !== before) return false;   // LibreOffice failed, or another CV was set meanwhile
  const wasRead = cvlib.importedFrom(storage) === before;
  writePrivate(storage.path('cv.pdf'), pdf);
  const after = cvlib.pdfHash(storage);
  writePrivate(linkFile(storage), JSON.stringify({pdf: after, by}) + '\n');
  if (wasRead) writePrivate(path.join(cvlib.dir(storage), 'import.json'), JSON.stringify({pdf: after}) + '\n');
  log('cv', 'Word CV drawn again with LibreOffice');
  return true;
}
