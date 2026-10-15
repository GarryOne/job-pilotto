// The rows a CI runner replays once more (owner via cc, 15 Oct 2026: a flaky check passes on its 2nd try): the PINNED rows of one runner's step-4 folder that are not same as live.
// A row with no result at all is not listed (a crash is not noise). node replay-unsame.mjs <step-4 dir> <replay-faithful.json>   -> one row name a line. Guard: e2e/test/replay-ratchet.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {isSame} from './replay-records.mjs';
import {load, pinned} from './lib/replay-ratchet.mjs';

// (records, the pinned names) -> the pinned rows among the records that are not same as live.
export const unsame = (records, pins) => records.filter(record => record.network && pins.includes(record.name) && !isSame(record)).map(record => record.name).sort();

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const [dir, pins] = process.argv.slice(2);
  if (!dir || !pins) { console.error('usage: node replay-unsame.mjs <step-4 dir> <replay-faithful.json>'); process.exit(2); }
  const records = fs.existsSync(dir) ? fs.readdirSync(dir).filter(file => file.endsWith('.json')).flatMap(file => { try { return [JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))]; } catch { return []; } }) : [];
  process.stdout.write(unsame(records, pinned(load(pins))).map(name => `${name}\n`).join(''));
}
