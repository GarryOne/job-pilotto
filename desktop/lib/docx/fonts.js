// The fonts a Word CV names (its styles, its text and its theme) that this computer lacks, as faces the renderer loads before drawing it
// (cv/docx-render.html): the same font downloaded once or its same-width twin, through lib/pdf-edit/fonts.js. An installed font needs
// nothing: Chromium finds it by name. A font that can't be found is left to Chromium's fallback. Guards: test/docx-render.test.js.
import {findFont} from '../pdf-edit/fonts.js';

const SYMBOL = /^(symbol|wingdings|webdings|marlett|ms (outlook|reference))/i;
const FACES = [{suffix: '', weight: 400, style: 'normal'}, {suffix: '-Bold', weight: 700, style: 'normal'},
  {suffix: '-Italic', weight: 400, style: 'italic'}, {suffix: '-BoldItalic', weight: 700, style: 'italic'}];

// zip: JSZip of the .docx. -> the font families it uses for text, in first-seen order.
export async function familiesOf(zip) {
  const names = new Set();
  for (const part of ['word/theme/theme1.xml', 'word/styles.xml', 'word/document.xml']) {
    const xml = await zip.file(part)?.async('string');
    if (!xml) continue;
    for (const m of xml.matchAll(/<a:latin typeface="([^"]+)"|w:(?:ascii|hAnsi)="([^"]+)"/g)) { const name = (m[1] || m[2]).trim(); if (name && !SYMBOL.test(name)) names.add(name); }
  }
  return [...names];
}

// -> [{family, weight, style, base64, from}] for the families not installed here. find: fonts.js findFont (a stub in tests).
export async function facesFor(families, {cacheDir, find = findFont, fetchImpl} = {}) {
  const faces = [];
  for (const family of families) {
    const regular = await find(family, '', {cacheDir, fetchImpl});
    if (!regular || regular.from === 'installed') continue;
    for (const {suffix, weight, style} of FACES) {
      const font = suffix ? await find(`${family}${suffix}`, '', {cacheDir, fetchImpl}) : regular;
      if (font) faces.push({family, weight, style, base64: Buffer.from(font.bytes).toString('base64'), from: font.from});
    }
  }
  return faces;
}
