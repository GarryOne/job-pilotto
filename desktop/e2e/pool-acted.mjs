// node pool-acted.mjs <smoke reports folder>...: the acted presses of CI pool runs (lib/pool-acted.mjs; spec 2026-10-12-one-next-move.md phase 3 step 2 "press": >= 10 presses acted, 0 worse by effect, the unblock
// rate and the cost shown). One folder per downloaded run (gh run download <id> --name pool-smoke-<id>). Reads only.
import fs from 'node:fs';
import path from 'node:path';
import {actedTable, resultsOf, slugOf} from './lib/pool-acted.mjs';

const rows = [];
let usd = 0;
for (const dir of process.argv.slice(2)) {
  let names = [];
  try { names = fs.readdirSync(dir).filter(name => name.endsWith('.app.log')); } catch { console.log(`${dir}: no folder`); continue; }
  const results = resultsOf(dir);
  for (const name of names) {
    const row = name.replace(/\.app\.log$/, ''), result = results.get(slugOf(row.replace(/^\d{4}-\d{2}-\d{2}-/, '')));
    usd += result?.usd || 0;
    rows.push({row: `${path.basename(path.resolve(dir, '..'))}/${row}`, log: fs.readFileSync(path.join(dir, name), 'utf8'), reached: result?.reached});
  }
}
const table = actedTable(rows);
console.log(`${table.acted} acted presses over ${rows.length} rows (the criterion needs >= 10); the batch's AI cost $${usd.toFixed(3)}`);
console.log(`worked ${table.worked}, failed ${table.failed}, WORSE by effect ${table.worse.length}${table.worse.length ? `: ${table.worse.map(item => `${item.row} door ${item.door}`).join(', ')}` : ''}; unblock rate ${(100 * table.unblockRate).toFixed(0)}%`);
for (const [why, entry] of Object.entries(table.byDoor).sort()) console.log(`  ${why.padEnd(12)} acted ${entry.acted}, worked ${entry.worked}, failed ${entry.failed}, worse ${entry.worse}${entry.worse ? '  <- this door is held back (kill switch)' : ''}`);
