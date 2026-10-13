// Tests: the whole text of a day-rolled log (app.log, engine.log), every day's file oldest first, then today's.
// A run that crosses midnight writes its start into yesterday's file and its end into today's (main red at 00:00 UTC, 13 Oct 2026).
import fs from 'node:fs';
import {dayFiles} from '../lib/log-days.js';

export function logText(file) {
  const read = name => { try { return fs.readFileSync(name, 'utf8'); } catch { return ''; } };
  return [...dayFiles(file).reverse().map(day => day.file), file].map(read).join('');
}
