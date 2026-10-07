// The app's own log, for debugging: <data folder>/logs/app.log (1 MB, then app.log.1), and the console.
// Never secrets and never your personal data: log field names, counts, sources and errors, not values.
import fs from 'node:fs';
import path from 'node:path';

let file = null;
const LIMIT = 1_000_000;
export function logTo(folder) {
  try { fs.mkdirSync(folder, {recursive: true}); file = path.join(folder, 'app.log'); } catch { file = null; }
}
export const logFile = () => file;
// A field is evidence, not a dump: each string is cut to FIELD_MAX and the line to LINE_MAX. 7 Oct 2026: every job-list
// run logged its last 3 output lines, 116 KB of job JSON each, so the 1 MB log held about a minute of history.
export const FIELD_MAX = 300, LINE_MAX = 4000;
const cut = (text, max) => (text.length > max ? `${text.slice(0, max)}… (+${text.length - max} chars)` : text);
const shorten = value => (typeof value === 'string' ? cut(value, FIELD_MAX)
  : Array.isArray(value) ? value.map(shorten)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shorten(item)])) : value);
export function format(area, message, data, at = new Date()) {
  return cut(`${at.toISOString()} [${area}] ${message}${data === undefined ? '' : ` ${JSON.stringify(shorten(data))}`}`, LINE_MAX);
}
export function log(area, message, data) {
  const line = format(area, message, data);
  // The terminal (npm start) shows only what went wrong; everything is in logs/app.log. JOB_PILOTTO_VERBOSE=1: all of it.
  if (process.env.JOB_PILOTTO_VERBOSE || data?.error || /\b(fail|error|refused|429)\b/i.test(message)) console.log(line);
  if (!file) return;
  try { if (fs.statSync(file).size > LIMIT) fs.renameSync(file, `${file}.1`); } catch {}
  try { fs.appendFileSync(file, `${line}\n`); } catch {}
}
