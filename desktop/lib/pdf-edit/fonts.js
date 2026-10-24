// Letters a CV's embedded font subset lacks (a PDF keeps only the letters it printed): the same face installed on this computer, else the
// same free font downloaded once (Google Fonts), else a free twin with the same letter widths, else nothing (the item keeps its wording).
// The font found is embedded by write.js for those letters only. Downloads are cached in the app's folder. Guards: test/pdf-edit-fonts.test.js.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fontkit from '@pdf-lib/fontkit';

// Free fonts drawn to the same widths as common office fonts, so a line keeps its length (metric-compatible families).
export const TWINS = {calibri: 'Carlito', cambria: 'Caladea', arial: 'Arimo', helvetica: 'Arimo', helveticaneue: 'Arimo', timesnewroman: 'Tinos',
  times: 'Tinos', couriernew: 'Cousine', georgia: 'Gelasio'};
const WEIGHTS = [['extralight', 200], ['ultralight', 200], ['semibold', 600], ['demibold', 600], ['extrabold', 800], ['ultrabold', 800],
  ['thin', 100], ['light', 300], ['medium', 500], ['bold', 700], ['heavy', 900], ['black', 900]];
const squash = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// A PDF font name as a family, weight and slant: "ABCDEF+TimesNewRomanPS-BoldItalicMT" -> {family: 'Times New Roman', weight: 700, italic: true}
export function familyOf(name) {
  const base = String(name || '').replace(/^[A-Z]{6}\+/, '');
  const [head, ...rest] = base.split(/[-,]/);
  const style = rest.join(' ').toLowerCase().replace(/[_\s]/g, '');
  const family = head.replace(/(PSMT|MT|PS)$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  const weight = WEIGHTS.find(([word]) => style.includes(word))?.[1] ?? 400;
  return {family, weight, italic: /italic|oblique/.test(style)};
}

const SYSTEM_DIRS = {
  darwin: ['/System/Library/Fonts', '/System/Library/Fonts/Supplemental', '/Library/Fonts', path.join(os.homedir(), 'Library', 'Fonts')],
  win32: [path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts'), path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Windows', 'Fonts')],
  linux: ['/usr/share/fonts', '/usr/local/share/fonts', path.join(os.homedir(), '.fonts'), path.join(os.homedir(), '.local', 'share', 'fonts')],
};

const filesIn = (dir, depth = 3) => {
  let out = [];
  try {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && depth) out = out.concat(filesIn(full, depth - 1));
      else if (/\.(ttf|otf)$/i.test(entry.name)) out.push(full);
    }
  } catch {}
  return out;
};

// The font file's face, when it is the family asked for. -> {font, bytes, distance} or null
// trusted: a file downloaded for that family (its inner name may differ, e.g. a renamed release).
const open = (file, want, trusted = false) => {
  try {
    const bytes = fs.readFileSync(file), font = fontkit.create(bytes);
    if (!trusted && squash(font.familyName) !== squash(want.family) && squash(font.postscriptName).indexOf(squash(want.family)) !== 0) return null;
    const weight = font['OS/2']?.usWeightClass || 400, italic = !!(font.italicAngle || (font['OS/2']?.fsSelection?.italic));
    return {font, bytes, distance: Math.abs(weight - want.weight) + (italic === want.italic ? 0 : 1000)};
  } catch { return null; }
};

const covers = (font, letters) => [...letters].every(ch => font.hasGlyphForCodePoint(ch.codePointAt(0)));

// Asks Google Fonts' CSS for one face and downloads its TrueType file (asked without a browser name, the CSS points to .ttf).
async function download(family, want, fetchImpl) {
  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:ital,wght@${want.italic ? 1 : 0},${want.weight}`;
  const css = await fetchImpl(url).then(r => (r.ok ? r.text() : ''));
  const src = css.match(/src:\s*url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/)?.[1];
  if (!src) return null;
  const response = await fetchImpl(src);
  return response.ok ? Buffer.from(await response.arrayBuffer()) : null;
}

// name: the PDF font's name; letters: what is missing. cacheDir: where downloads are kept. -> {name, bytes, fm, glyphs: {ch: {width}}, from} | null
// from: 'installed' | 'download' | 'twin', for the review's note.
export async function findFont(name, letters, {cacheDir, fetchImpl = globalThis.fetch, dirs = SYSTEM_DIRS[process.platform] || []} = {}) {
  const want = familyOf(name);
  if (!want.family) return null;
  const pick = (found, from) => {
    if (!found || !covers(found.font, letters)) return null;
    const glyphs = {};
    for (const ch of letters) glyphs[ch] = {width: found.font.glyphForCodePoint(ch.codePointAt(0)).advanceWidth * 1000 / found.font.unitsPerEm};
    return {name, bytes: found.bytes, fm: [0.001, 0, 0, 0.001, 0, 0], glyphs, from};
  };
  // 1. installed on this computer
  const stem = squash(want.family).slice(0, 5);
  const local = dirs.flatMap(dir => filesIn(dir)).filter(file => squash(path.basename(file)).includes(stem))
    .map(file => open(file, want)).filter(Boolean).sort((a, b) => a.distance - b.distance)[0];
  const installed = pick(local, 'installed');
  if (installed) return installed;
  // 2. the same family, downloaded once; 3. its same-width twin
  for (const [family, from] of [[want.family, 'download'], [TWINS[squash(want.family)], 'twin']]) {
    if (!family || !cacheDir) continue;
    const file = path.join(cacheDir, `${squash(family)}-${want.weight}${want.italic ? 'i' : ''}.ttf`);
    if (!fs.existsSync(file)) {
      let bytes = null;
      try { bytes = fetchImpl ? await download(family, want, fetchImpl) : null; } catch {}
      if (!bytes) continue;
      fs.mkdirSync(cacheDir, {recursive: true});
      fs.writeFileSync(file, bytes);
    }
    const found = pick(open(file, {...want, family}, true), from);
    if (found) return found;
  }
  return null;
}
