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
export function log(area, message, data) {
  const line = `${new Date().toISOString()} [${area}] ${message}${data === undefined ? '' : ` ${JSON.stringify(data)}`}`;
  // The terminal (npm start) shows only what went wrong; everything is in logs/app.log. JOB_PILOTTO_VERBOSE=1: all of it.
  if (process.env.JOB_PILOTTO_VERBOSE || data?.error || /\b(fail|error|refused|429)\b/i.test(message)) console.log(line);
  if (!file) return;
  try { if (fs.statSync(file).size > LIMIT) fs.renameSync(file, `${file}.1`); } catch {}
  try { fs.appendFileSync(file, `${line}\n`); } catch {}
}
