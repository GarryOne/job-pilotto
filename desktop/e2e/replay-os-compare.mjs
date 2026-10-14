// The scheduled replay's runner measurement (owner, 14 Oct 2026: spread CI over Linux too): the same rows replayed on a Linux runner next to the macOS ones, per row "same as live" on each,
// so the owner sees which rows could move to Linux. Never gating: nothing here is judged against the baseline. Guard: e2e/test/replay-os-compare.test.mjs.
// Run: node replay-os-compare.mjs <mac step-4 dir> <linux step-4 dir>   -> Markdown on stdout
import fs from 'node:fs';
import path from 'node:path';
import {isSame} from './replay-records.mjs';

const recordsIn = dir => (dir && fs.existsSync(dir) ? fs.readdirSync(dir).filter(file => file.endsWith('.json')).flatMap(file => { try { return [JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))]; } catch { return []; } }) : []);
const hits = record => (record?.network ? `${record.network.hit}/${record.live?.asks ?? '?'}${record.network.extra ? ` +${record.network.extra}` : ''}` : '–');
const ended = record => (record?.outcome ? `${record.outcome.reached || '?'} ${record.outcome.filled ?? '?'}/${record.outcome.left ?? '?'}` : '–');

// (mac records, linux records) -> {rows: [{name, mac, linux, macSame, linuxSame, agree}], macSame, linuxSame, both, total}
export function compare(mac, linux) {
  const byName = new Map(linux.map(record => [record.name, record]));
  const rows = mac.map(record => { const other = byName.get(record.name), macSame = isSame(record), linuxSame = other ? isSame(other) : null;
    return {name: record.name, mac: record, linux: other || null, macSame, linuxSame, agree: linuxSame === null ? null : macSame === linuxSame}; }).sort((a, b) => a.name.localeCompare(b.name));
  return {rows, total: rows.length, macSame: rows.filter(row => row.macSame).length, linuxSame: rows.filter(row => row.linuxSame).length, both: rows.filter(row => row.macSame && row.linuxSame).length, ran: rows.filter(row => row.linux).length};
}

export function markdown(result) {
  if (!result.ran) return '## Linux replay (measurement)\n\nNo Linux result this run.\n';
  const lines = [`## Linux replay (measurement, never gating): same as live on Mac ${result.macSame}, on Linux ${result.linuxSame}, on both ${result.both} of ${result.total} rows`, '',
    '| Row | Mac asks | Linux asks | Mac end | Linux end | Linux vs Mac |', '|---|---|---|---|---|---|'];
  for (const row of [...result.rows].sort((a, b) => (a.agree === false ? 0 : 1) - (b.agree === false ? 0 : 1) || a.name.localeCompare(b.name))) {
    const word = row.linux === null ? 'not run' : row.agree ? (row.macSame ? '✅ same on both' : 'both not same') : row.linuxSame ? 'Linux same, Mac not' : '❌ Linux misses';
    lines.push(`| ${row.name} | ${hits(row.mac)}${row.macSame ? ' ✅' : ''} | ${hits(row.linux)}${row.linuxSame ? ' ✅' : ''} | ${ended(row.mac)} | ${ended(row.linux)} | ${word} |`);
  }
  return `${lines.join('\n')}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const [macDir, linuxDir] = process.argv.slice(2);
  if (!macDir || !linuxDir) { console.error('usage: node replay-os-compare.mjs <mac step-4 dir> <linux step-4 dir>'); process.exit(2); }
  process.stdout.write(markdown(compare(recordsIn(macDir), recordsIn(linuxDir))));
}
