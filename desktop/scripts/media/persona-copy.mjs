// The temp folder one recording runs on (desktop/scripts/media): desktop/demo, the persona's own files laid over it, and every date moved to the
// recording's week, so a calendar shows near-future interviews whenever main re-records. Pure parts guarded by desktop/test/media-persona.test.js.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DAY = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Days from the persona's anchor day (media.json "today") to `now`, in whole weeks: weekday names in its text ("Tue 13 Oct") stay right.
export function weekShift(anchor, now = new Date()) {
  if (!anchor) return 0;
  const days = (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.parse(`${anchor}T00:00:00Z`)) / DAY;
  return Math.round(days / 7) * 7;
}

const moved = (year, month, day, days) => new Date(Date.UTC(year, month, day) + days * DAY);

// Every date in a text moved by `days`: ISO days (2026-10-12, also inside a timestamp) and "12 Oct" (read in `year`).
export function shiftDates(text, days, year) {
  if (!days) return text;
  return String(text)
    .replace(/\b(\d{4})-(\d{2})-(\d{2})(?!\d)/g, (_, y, m, d) => moved(Number(y), Number(m) - 1, Number(d), days).toISOString().slice(0, 10))
    .replace(new RegExp(`\\b(\\d{1,2}) (${MONTHS.join('|')})\\b`, 'g'), (_, d, month) => {
      const date = moved(year, MONTHS.indexOf(month), Number(d), days);
      return `${String(date.getUTCDate()).padStart(d.length, '0')} ${MONTHS[date.getUTCMonth()]}`;
    });
}

// -> the temp folder: the app's demo files, then the persona's (a persona lists only what it changes), dates shifted. media.json stays out.
export function personaCopy({folder, today}, {demo, now = new Date()}) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-media-'));
  const days = weekShift(today, now), year = Number(String(today || '').slice(0, 4)) || now.getFullYear();
  for (const source of [...new Set([path.resolve(demo), path.resolve(folder)])]) {
    for (const file of fs.readdirSync(source)) {
      const from = path.join(source, file);
      if (file === 'media.json') continue;
      if (fs.statSync(from).isDirectory()) { fs.cpSync(from, path.join(data, file), {recursive: true}); continue; }   // config/: the engine's settings
      if (/\.(json|jsonl|md)$/.test(file)) fs.writeFileSync(path.join(data, file), shiftDates(fs.readFileSync(from, 'utf8'), days, year));
      else fs.copyFileSync(from, path.join(data, file));
    }
  }
  return data;
}
