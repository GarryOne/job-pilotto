// node pool-shadow.mjs <smoke reports folder>...: the shadow question's agree / would_act / worse table over CI pool runs (lib/pool-shadow.mjs; spec 2026-10-12-one-next-move.md, the switch-on criteria per
// dead end): one folder per downloaded run (gh run download <id> --name pool-smoke-<id>); reads every row's app log. Prints, per kind of stop, how the fallback compared to the real stop, the rows
// that would have been WORSE (the switch-on needs none), the rows where it would act where the stop did not (WOULD ACT: a candidate until the CI pool acts), and the question's cost. Reads only.
import fs from 'node:fs';
import path from 'node:path';
import {personPrecision, shadowTable} from './lib/pool-shadow.mjs';

const slug = text => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// the folder's day reports (*.json: {results: {<row name>: {reached}}}) -> Map(slug of the row name -> where it ended)
function reachedOf(dir) {
  const found = new Map();
  let files = [];
  try { files = fs.readdirSync(dir).filter(name => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)); } catch { return found; }
  for (const file of files) { try { for (const [name, result] of Object.entries(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')).results || {})) if (result?.reached) found.set(slug(name), String(result.reached)); } catch { /* a cut report */ } }
  return found;
}
const rows = [];
for (const dir of process.argv.slice(2)) {
  let names = [];
  try { names = fs.readdirSync(dir).filter(name => name.endsWith('.app.log')); } catch { console.log(`${dir}: no folder`); continue; }
  const reached = reachedOf(dir);   // where each row ended (the day's report), by the row's name
  for (const name of names) {
    const row = name.replace(/\.app\.log$/, '');
    rows.push({row: `${path.basename(path.resolve(dir, '..'))}/${row}`, log: fs.readFileSync(path.join(dir, name), 'utf8'), reached: reached.get(slug(row.replace(/^\d{4}-\d{2}-\d{2}-/, '')))});
  }
}
const table = shadowTable(rows);
const pad = (text, width) => String(text).padEnd(width);
console.log(`${table.total} real stops over ${rows.length} rows; the question cost $${table.usd.toFixed(4)}`);
console.log(`${pad('stop', 12)} agree would_act worse not_asked`);
for (const [why, entry] of Object.entries(table.byWhy).sort()) console.log(`${pad(why, 12)} ${String(entry.agree).padStart(5)} ${String(entry.would_act).padStart(6)} ${String(entry.worse).padStart(5)} ${String(entry.not_asked).padStart(9)}`);
console.log(`Worse (acting would be wrong; the switch-on needs none): ${table.worse.length}${table.worse.length ? `: ${table.worse.map(item => `${item.row} door ${item.door}`).join(', ')}` : ''}`);
console.log(`Would act (a move where the stop made none; unjudged until the acting run's effect): ${table.would_act.length}${table.would_act.length ? `: ${table.would_act.map(item => `${item.row} door ${item.door}`).join(', ')}` : ''}`);
const person = personPrecision(rows);
console.log(`Person verb ("name the hand-off", shadow): ${person.answers} answers, ${person.judged} judged by where the row ended: right ${person.right}, wrong ${person.wrong} (wrong and confident ${person.wrongConfident}), unjudged ${person.unjudged}${person.judged ? `; precision ${(100 * person.right / person.judged).toFixed(0)}%` : ''}`);
