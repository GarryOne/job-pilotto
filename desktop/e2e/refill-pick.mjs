// The refill workflow's first job: which pinned rows to refill, the estimate, the caps (lib/refill.mjs; .github/workflows/replay-refill.yml). Prints the estimate first.
//   node refill-pick.mjs <replay-faithful.json> <PR gate step4 dir | -> [--all] [--max-asks N]   -> {"rows": [names], "asks", "usd", "line", "refused"} on stdout (one JSON line)
import fs from 'node:fs';
import path from 'node:path';
import {load, pinned} from './lib/replay-ratchet.mjs';
import {capRefusal, matrixOf, pickRefill, MAX_ASKS} from './lib/refill.mjs';

const [pinsFile, dir] = process.argv.slice(2), flag = name => { const at = process.argv.indexOf(name); return at > 0 ? process.argv[at + 1] : ''; };
if (!pinsFile || !dir) { console.error('usage: node refill-pick.mjs <replay-faithful.json> <step4 dir | -> [--all] [--max-asks N]'); process.exit(2); }
const records = dir === '-' || !fs.existsSync(dir) ? [] : fs.readdirSync(dir).filter(file => file.endsWith('.json')).flatMap(file => { try { return [JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))]; } catch { return []; } });
const picked = pickRefill({pins: pinned(load(pinsFile)), records, all: process.argv.includes('--all')});
const refused = capRefusal(picked, {maxAsks: Number(flag('--max-asks')) || MAX_ASKS});
const line = `refill: ${picked.rows.length} row(s), about ${picked.asks} ask(s), estimate $${picked.usd.toFixed(2)} (${picked.rows.map(row => row.name).join(', ') || 'none'})${refused ? `\n${refused}` : ''}`;
console.log(JSON.stringify({rows: matrixOf(picked.rows), asks: picked.asks, usd: picked.usd, line, refused}));
