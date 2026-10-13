// node pool-shadow.mjs <smoke reports folder>...: the shadow question's agree / better / worse table over CI pool runs (lib/pool-shadow.mjs; spec 2026-10-12-one-next-move.md, the switch-on criteria per
// dead end): one folder per downloaded run (gh run download <id> --name pool-smoke-<id>); reads every row's app log. Prints, per kind of stop, how the fallback compared to the real stop, the rows
// that would have been WORSE (the switch-on needs none), the rows where it would act where the stop did not (BETTER: a candidate until the CI pool acts), and the question's cost. Reads only.
import fs from 'node:fs';
import path from 'node:path';
import {shadowTable} from './lib/pool-shadow.mjs';

const rows = [];
for (const dir of process.argv.slice(2)) {
  let names = [];
  try { names = fs.readdirSync(dir).filter(name => name.endsWith('.app.log')); } catch { console.log(`${dir}: no folder`); continue; }
  for (const name of names) rows.push({row: `${path.basename(path.resolve(dir, '..'))}/${name.replace(/\.app\.log$/, '')}`, log: fs.readFileSync(path.join(dir, name), 'utf8')});
}
const table = shadowTable(rows);
const pad = (text, width) => String(text).padEnd(width);
console.log(`${table.total} real stops over ${rows.length} rows; the question cost $${table.usd.toFixed(4)}`);
console.log(`${pad('stop', 12)} agree better worse not_asked`);
for (const [why, entry] of Object.entries(table.byWhy).sort()) console.log(`${pad(why, 12)} ${String(entry.agree).padStart(5)} ${String(entry.better).padStart(6)} ${String(entry.worse).padStart(5)} ${String(entry.not_asked).padStart(9)}`);
console.log(`Worse (acting would be wrong; the switch-on needs none): ${table.worse.length}${table.worse.length ? `: ${table.worse.map(item => `${item.row} door ${item.door}`).join(', ')}` : ''}`);
console.log(`Better (a move where the stop made none; confirmed only when the CI pool acts): ${table.better.length}${table.better.length ? `: ${table.better.map(item => `${item.row} door ${item.door}`).join(', ')}` : ''}`);
