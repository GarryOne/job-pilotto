// Settings → Logs: reads the app's log files for the window a page at a time, so a big log never reaches it whole:
// one day's newest PAGE lines (read backwards from the end), "Show more" for older ones up to MAX_SHOWN, and a search
// that sends back only the newest MATCHES hits. Lines are cut to LINE_CHARS.
import fs from 'node:fs';
import path from 'node:path';
import {dayFiles, dayFile} from './log-days.js';

// Every log: one file per day (lib/log-days.js).
export const LOGS = {
  app: {file: 'app.log'},
  engine: {file: 'engine.log'},
  notion: {file: 'notion-requests.log'},
};
export const PAGE = 100, MATCHES = 100, MAX_SHOWN = 1000, LINE_CHARS = 1000;
const CHUNK = 64 * 1024;
const cut = line => (line.length > LINE_CHARS ? `${line.slice(0, LINE_CHARS)}… (+${line.length - LINE_CHARS} chars)` : line);
const exists = file => { try { return fs.statSync(file).isFile(); } catch { return false; } };

// The days a log has, newest first: [{day: 'today'|'YYYY-MM-DD', bytes}]; today only while its file exists.
export function days(folder, name) {
  const log = LOGS[name];
  if (!log) return [];
  const current = path.join(folder, log.file);
  const size = file => { try { return fs.statSync(file).size; } catch { return 0; } };
  const list = exists(current) ? [{day: 'today', bytes: size(current)}] : [];
  list.push(...dayFiles(current).map(({day, file}) => ({day, bytes: size(file)})));
  return list;
}

// The files to read, newest first: one day's (day 'today' or 'YYYY-MM-DD'), or every day's (day '').
export function files(folder, name, day = 'today') {
  const log = LOGS[name];
  if (!log) return [];
  const current = path.join(folder, log.file);
  const older = dayFiles(current).map(d => d.file);
  if (day === 'today') return [current].filter(exists);
  if (!day) return [current, ...older].filter(exists);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return [];
  return [dayFile(current, day)].filter(exists);
}

// One file's lines from the end, newest first, until `want` are read (64 KB at a time).
function linesFromEnd(file, want) {
  const out = [];
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch { return out; }
  try {
    let position = fs.fstatSync(fd).size, rest = '';
    while (position > 0 && out.length < want) {
      const size = Math.min(CHUNK, position);
      position -= size;
      const buffer = Buffer.alloc(size);
      fs.readSync(fd, buffer, 0, size, position);
      const parts = (buffer.toString('utf8') + rest).split('\n');
      rest = parts.shift();   // may be the end of a line that started in the chunk before
      for (let i = parts.length - 1; i >= 0 && out.length < want; i -= 1) if (parts[i]) out.push(parts[i]);
    }
    if (position === 0 && rest && out.length < want) out.push(rest);
  } finally { fs.closeSync(fd); }
  return out;
}

// The newest `count` lines after skipping the newest `skip`, oldest first (as a log reads), and whether older ones exist.
export function tail(folder, name, {day = 'today', skip = 0, count = PAGE} = {}) {
  skip = Math.max(0, Math.min(MAX_SHOWN, Math.round(skip) || 0));
  count = Math.max(1, Math.min(PAGE, Math.round(count) || PAGE));
  const want = skip + count + 1;
  const newest = [];
  for (const file of files(folder, name, day)) {
    newest.push(...linesFromEnd(file, want - newest.length));
    if (newest.length >= want) break;
  }
  const page = newest.slice(skip, skip + count);
  return {lines: page.reverse().map(cut), more: newest.length > skip + count && skip + count < MAX_SHOWN};
}

// Lines containing the words (any case), in one day or every day (day ''): the newest MATCHES, oldest first. Files are
// read newest first and the search stops once it has MATCHES hits (`more`: older ones may exist), so a month of a busy
// engine log is never read whole for one search.
export async function search(folder, name, query, {day = '', limit = MATCHES} = {}) {
  const needle = String(query || '').trim().toLowerCase().slice(0, 200);
  if (!needle) return {lines: [], more: false};
  const hits = [];
  for (const file of files(folder, name, day)) {
    let text = '';
    try { text = await fs.promises.readFile(file, 'utf8'); } catch { continue; }
    const lines = text.split('\n');
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      if (!lines[i] || !lines[i].toLowerCase().includes(needle)) continue;
      if (hits.length === limit) return {lines: hits.reverse(), more: true};
      hits.push(cut(lines[i]));
    }
  }
  return {lines: hits.reverse(), more: false};
}
