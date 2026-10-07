// The app's logs, one file per day for KEEP_DAYS days: today's is always <name>.log (app.log, engine.log), so every
// reader and `grep logs/app.log` keeps working; at the first write of a new day it becomes <name>-YYYY-MM-DD.log
// (the day it was written, this Mac's time). Older days are deleted, and so are the oldest when all of them pass
// maxTotal. A day that passes its own cap keeps its newest part (owner, 7 Oct 2026: history by day, a month back).
import fs from 'node:fs';
import path from 'node:path';

export const KEEP_DAYS = 30;
const pad = n => String(n).padStart(2, '0');
export const localDay = (at = new Date()) => `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
export const dayFile = (file, day) => file.replace(/\.log$/, `-${day}.log`);

// The day files of `file` (app.log → app-2026-10-06.log …), newest first, as {day, file}.
export function dayFiles(file) {
  const dir = path.dirname(file), stem = path.basename(file).replace(/\.log$/, '');
  const pattern = new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d{4}-\\d{2}-\\d{2})\\.log$`);
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names.map(name => name.match(pattern)).filter(Boolean)
    .map(match => ({day: match[1], file: path.join(dir, match[0])})).sort((a, b) => b.day.localeCompare(a.day));
}

// Called before a write: today's file still holding an earlier day gets that day's name, then old days go.
// Cheap: the file is looked at once per day per log (`seen`).
const seen = new Map();
export function rollDay(file, {now = new Date(), keepDays = KEEP_DAYS, maxTotal = Infinity} = {}) {
  const today = localDay(now);
  if (seen.get(file) === today) return false;
  seen.set(file, today);
  let rolled = false;
  try {
    const day = localDay(fs.statSync(file).mtime);
    if (day !== today) {
      const target = dayFile(file, day);
      if (!fs.existsSync(target)) fs.renameSync(file, target);
      else { const moved = aside(file); fs.appendFileSync(target, fs.readFileSync(moved)); fs.unlinkSync(moved); }
      rolled = true;
    }
  } catch {}
  prune(file, {now, keepDays, maxTotal});
  return rolled;
}
export const forgetSeen = () => seen.clear();   // tests

// Days older than keepDays go, then the oldest while all of them together pass maxTotal bytes. The size-rotated files
// of before 7 Oct 2026 (app.log.1 … .3, engine.log.1) go too: nothing reads them any more.
export function prune(file, {now = new Date(), keepDays = KEEP_DAYS, maxTotal = Infinity} = {}) {
  for (const n of [1, 2, 3]) { try { fs.unlinkSync(`${file}.${n}`); } catch {} }
  const oldest = new Date(now); oldest.setDate(oldest.getDate() - keepDays);
  const cutoff = localDay(oldest);
  let total = 0;
  try { total = fs.statSync(file).size; } catch {}
  for (const {day, file: old} of dayFiles(file)) {
    let size = 0;
    try { size = fs.statSync(old).size; } catch { continue; }
    if (day <= cutoff || total + size > maxTotal) { try { fs.unlinkSync(old); } catch {} } else total += size;
  }
}

// Another process may append at any moment (the Python jobs write notion-requests.log too, opening it per line): the
// file is first renamed aside, atomically, so a line written meanwhile starts a new file instead of being lost.
function aside(file) {
  const moved = `${file}.${process.pid}.moving`;
  fs.renameSync(file, moved);
  return moved;
}

// A day past its cap keeps its newest `keep` bytes, from a line start (appended back, after any line written meanwhile).
export function capDay(file, max, keep = Math.floor(max / 2)) {
  try {
    const size = fs.statSync(file).size;
    if (size <= max) return false;
    const moved = aside(file);
    const fd = fs.openSync(moved, 'r'), length = Math.min(keep, fs.fstatSync(fd).size), buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, fs.fstatSync(fd).size - length); fs.closeSync(fd);
    const text = buffer.toString('utf8');
    fs.appendFileSync(file, text.slice(text.indexOf('\n') + 1));
    fs.unlinkSync(moved);
    return true;
  } catch { return false; }
}
