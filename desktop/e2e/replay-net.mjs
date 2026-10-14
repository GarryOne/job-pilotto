// Replays a live row from its network record (lib/net-record.mjs), the site's own scripts running, memo-only AI.
//   node replay-net.mjs <record dir> <out dir> [--slow] [--no-clock]
// The row runs exactly as live (lib/live-row.mjs runLiveRow: the app, Apply, the real extension), but its browser resolves no host (offline) and every
// request is served from the record; the AI answers only from the live run's kept answers, at their live latency; a miss is refused and counted.
// Writes <out>/replay.json (requests by rule, not recorded, misses by step) beside the run's own end.png and step-*.png.
/* global navigator */
import fs from 'node:fs';
import path from 'node:path';
import {runLiveRow} from './lib/live-row.mjs';
import {startRealExtension} from './lib/real-extension.mjs';
import {netReplay} from './lib/net-record.mjs';
import {forceScrollbar} from './lib/scrollbar.mjs';
import {seedRandom} from './lib/seeded-random.mjs';
import {outputOfLog, parseLive} from './lib/smoke.mjs';
import {ELIGIBILITY_ENV, recordedEligibility} from './lib/pool-eligibility.mjs';

const [recordDir, out] = process.argv.slice(2), SLOW = process.argv.includes('--slow'), NO_CLOCK = process.argv.includes('--no-clock'), SCROLLBAR = process.argv.includes('--linux-scrollbar'), CPU = Number((process.argv.find(arg => arg.startsWith('--cpu=')) || '').slice(6)) || 0;
if (!recordDir || !out) { console.error('usage: node replay-net.mjs <record dir> <out dir> [--slow] [--no-clock]'); process.exit(2); }
const record = JSON.parse(fs.readFileSync(path.join(recordDir, 'record.json'), 'utf8'));
const bodies = new Map(fs.readdirSync(path.join(recordDir, 'bodies')).map(hash => [hash, fs.readFileSync(path.join(recordDir, 'bodies', hash))]));
fs.mkdirSync(out, {recursive: true});
if (fs.existsSync(path.join(recordDir, 'model-memo.json'))) fs.copyFileSync(path.join(recordDir, 'model-memo.json'), path.join(out, 'model-memo.json')); else fs.writeFileSync(path.join(out, 'model-memo.json'), '{}');   // a live run whose AI was refused kept no answers: every ask is reported missing   // a copy: the live run's kept answers stay as they were
process.env.JOB_PILOTTO_SITE_LEDGER_DIR = path.join(out, 'ledger');   // no site is visited: never a visit in the Mac's ledger
delete process.env.JP_NET_RECORD_DIR;
process.env.JOB_PILOTTO_MODEL_MEMO_HITS = path.join(out, 'hits.txt');   // each kept answer the replay used (lib/ai/model-memo.js): test (a), every live ask hits
process.env.JOB_PILOTTO_MODEL_MEMO_LATENCY_CAP_MS ||= '20000';   // the live AI's own time, not capped at 3 s: the replay keeps the live pace (P0b's gap)
const SW_BLOCK = () => { if (navigator.serviceWorker) navigator.serviceWorker.register = async () => {}; };

let replay = null;
const browser = async options => {
  const run = await startRealExtension({...options, offline: true});
  await run.context.addInitScript(SW_BLOCK);
  await seedRandom(run.context, record.seed);   // the live run's own seed (a record made before it: the page's own random)
  await run.context.addInitScript({path: path.join(path.dirname(new URL(import.meta.url).pathname), 'lib', 'upload-events.js')});   // a fulfilled upload fires no upload events (lib/upload-events.js)
  // The live browser's scrollbar width (the record's own, else --linux-scrollbar for a record made before it: a CI runner draws 15 px, a Mac none)
  await forceScrollbar(run.context, Number.isFinite(record.scrollbar) ? record.scrollbar : SCROLLBAR ? 15 : undefined);
  if (!NO_CLOCK) await run.context.clock.install({time: record.startMs});
  if (CPU > 1) await (await run.context.newCDPSession(run.page)).send('Emulation.setCPUThrottlingRate', {rate: CPU});   // a CI runner is slower than a Mac: --cpu=4 slows this browser to about its pace
  const pageLog = page => { page.on('pageerror', error => fs.appendFileSync(path.join(out, 'page-errors.txt'), `pageerror ${String(error.message).slice(0, 300)}\n`)); page.on('console', message => { if (['error', 'warning'].includes(message.type())) fs.appendFileSync(path.join(out, 'page-errors.txt'), `${message.type()} ${message.text().slice(0, 300)}\n`); }); };
  run.context.pages().forEach(pageLog); run.context.on('page', pageLog);
  replay = await netReplay(run.context, {entries: record.entries, bodies}, {slow: SLOW, say: line => console.log(`replay: ${line}`)});
  return run;
};
const first = record.entries.find(entry => entry.type === 'document')?.url || record.url;
const liveLog = (() => { try { return fs.readFileSync(path.join(recordDir, 'app.log'), 'utf8'); } catch { return ''; } })();
// The eligibility stop as the live run had it (a pool run turns it off: lib/pool-eligibility.mjs); left on, the kept "not a fit" answer ends the fill early.
if (recordedEligibility(record, liveLog) === 'off') process.env[ELIGIBILITY_ENV] = 'off';
// The replay's watch may last as long as the live run did (its app log's first to last line) plus 90 s, 120-300 s: the replay starts ~25-35 s later (the offline app)
// and drifts further behind as it goes (coreweave, 14 Oct 2026: 22 s late at the first page, 43 s at the AI's answers), so a flat 120 s cut it before its form was
// reported. It is a cap, not a length: a row that finished still ends on its quiet window.
export const replaySeconds = text => { const times = String(text).split('\n').map(line => Date.parse(line.slice(0, 24))).filter(Number.isFinite);
  return times.length > 1 ? Math.min(300, Math.max(120, Math.round((times.at(-1) - times[0]) / 1000) + 90)) : 120; };
const result = await runLiveRow({posting: {url: first, title: '', company: ''}, captureDir: out, ask: false, browser, say: console.log, seconds: replaySeconds(liveLog)});
const log = result.appLog || '', misses = log.split('\n').filter(line => /not in the row's kept answers/.test(line));
const live = Object.keys(JSON.parse(fs.readFileSync(path.join(out, 'model-memo.json'), 'utf8'))).filter(key => !key.includes('#'));
const hits = new Set((() => { try { return fs.readFileSync(path.join(out, 'hits.txt'), 'utf8').split('\n').filter(Boolean); } catch { return []; } })());
// The row's outcome, read as a live row is (lib/smoke.mjs parseLive): the step reached, boxes filled and left; the live run's from the record's own app log.
const outcomeOf = text => { const r = parseLive(outputOfLog(text, text.trim() ? first : '')); return {reached: r.reached, filled: r.filled, left: r.left}; };
const summary = {outcome: outcomeOf(log), liveOutcome: liveLog ? outcomeOf(liveLog) : null, liveAsks: live.length, liveHit: live.filter(key => hits.has(key)).length, liveNotAsked: live.filter(key => !hits.has(key)).length, seconds: result.seconds, counts: replay?.counts, misses: misses.length, missLines: misses.map(line => line.slice(24, 200)), tripped: result.tripped};
fs.writeFileSync(path.join(out, 'replay.json'), `${JSON.stringify(summary, null, 1)}\n`);
console.log(`replay-net: done ${JSON.stringify({...summary, missLines: undefined})}`);
