// PROOF ONLY (branch replay-proof, never merged): replay a live row from its network record (lib/net-record.mjs), the site's own scripts running, memo-only AI.
//   node replay-net.mjs <record dir> <out dir> [--slow] [--no-clock]
// The row runs exactly as live (lib/live-row.mjs runLiveRow: the app, Apply, the real extension), but its browser resolves no host (offline) and every
// request is served from the record; the AI answers only from the live run's kept answers, at their live latency; a miss is refused and counted.
// Writes <out>/replay.json (requests by rule, not recorded, misses by step) beside the run's own end.png and step-*.png.
import fs from 'node:fs';
import path from 'node:path';
import {runLiveRow} from './lib/live-row.mjs';
import {startRealExtension} from './lib/real-extension.mjs';
import {netReplay} from './lib/net-record.mjs';

const [recordDir, out] = process.argv.slice(2), SLOW = process.argv.includes('--slow'), NO_CLOCK = process.argv.includes('--no-clock');
if (!recordDir || !out) { console.error('usage: node replay-net.mjs <record dir> <out dir> [--slow] [--no-clock]'); process.exit(2); }
const record = JSON.parse(fs.readFileSync(path.join(recordDir, 'record.json'), 'utf8'));
const bodies = new Map(fs.readdirSync(path.join(recordDir, 'bodies')).map(hash => [hash, fs.readFileSync(path.join(recordDir, 'bodies', hash))]));
fs.mkdirSync(out, {recursive: true});
fs.copyFileSync(path.join(recordDir, 'model-memo.json'), path.join(out, 'model-memo.json'));   // a copy: the live run's kept answers stay as they were
process.env.JOB_PILOTTO_SITE_LEDGER_DIR = path.join(out, 'ledger');   // no site is visited: never a visit in the Mac's ledger
delete process.env.JP_NET_RECORD_DIR;
process.env.JP_PROOF_HITS = path.join(out, 'hits.txt');   // each kept answer the replay used (lib/ai/model-memo.js, proof only): test (a), every live ask hits
process.env.JP_PROOF_LATENCY_CAP_MS ||= '20000';   // the live AI's own time, not capped at 3 s: the replay keeps the live pace (P0b's gap)
const SW_BLOCK = () => { if (navigator.serviceWorker) navigator.serviceWorker.register = async () => {}; };   // eslint-disable-line no-undef

let replay = null;
const browser = async options => {
  const run = await startRealExtension({...options, offline: true});
  await run.context.addInitScript(SW_BLOCK);
  if (!NO_CLOCK) await run.context.clock.install({time: record.startMs});
  replay = await netReplay(run.context, {entries: record.entries, bodies}, {slow: SLOW, say: line => console.log(`replay: ${line}`)});
  return run;
};
const first = record.entries.find(entry => entry.type === 'document')?.url || record.url;
const result = await runLiveRow({posting: {url: first, title: '', company: ''}, captureDir: out, ask: false, browser, say: console.log});
const log = result.appLog || '', misses = log.split('\n').filter(line => /not in the row's kept answers/.test(line));
const live = Object.keys(JSON.parse(fs.readFileSync(path.join(recordDir, 'model-memo.json'), 'utf8'))).filter(key => !key.includes('#'));
const hits = new Set((() => { try { return fs.readFileSync(path.join(out, 'hits.txt'), 'utf8').split('\n').filter(Boolean); } catch { return []; } })());
const summary = {liveAsks: live.length, liveHit: live.filter(key => hits.has(key)).length, liveNotAsked: live.filter(key => !hits.has(key)).length, seconds: result.seconds, counts: replay?.counts, misses: misses.length, missLines: misses.map(line => line.slice(24, 200)), tripped: result.tripped};
fs.writeFileSync(path.join(out, 'replay.json'), `${JSON.stringify(summary, null, 1)}\n`);
console.log(`replay-net: done ${JSON.stringify({...summary, missLines: undefined})}`);
