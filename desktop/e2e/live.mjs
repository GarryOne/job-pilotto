// npm run live -- <posting url> [--title <t>] [--company <c>] [--capture <dir>] [--old <extension dir>] [--seconds <watch, default 120>]: one HELD live row on the app's own path without Electron
// (lib/live-row.mjs): the fake applicant, the app's own Apply, the real extension on the real site, nothing pressed by the harness, never Submit; the privacy
// tripwire on. Every run but a smoke row's (--no-library: smoke.mjs keeps it with its result) is kept in the captures library (lib/capture-library.mjs). Prints the evidence lines a live run prints and where its capture is (a row replay can start from it: npm run row -- <capture folder>).
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import {keepCapture} from './lib/capture-library.mjs';
import {runLiveRow} from './lib/live-row.mjs';
import {outputOfLog} from './lib/smoke.mjs';

const args = process.argv.slice(2), flag = name => { const at = args.indexOf(`--${name}`); return at >= 0 ? args[at + 1] : ''; };
const url = args.find(arg => /^https?:\/\//.test(arg));
if (!url) { console.error('live: give a posting url'); process.exit(2); }
const captureDir = flag('capture') || fs.mkdtempSync(path.join(os.tmpdir(), 'jp-live-'));
let result;
try { result = await runLiveRow({posting: {url, title: flag('title'), company: flag('company')}, captureDir, extensionDir: flag('old') || undefined, ...(Number(flag('seconds')) > 0 ? {seconds: Number(flag('seconds'))} : {}), say: console.log}); }
catch (error) { if (error.name !== 'SiteLimitError') throw error; console.error(error.message); process.exit(3); }   // the per-site daily limit (lib/site-ledger.mjs)
console.log(`live: ${result.seconds} s${result.tripped ? `; ${result.tripped}` : `; capture in ${captureDir}`}`);
if (result.ai) console.log(`live: AI spend $${result.ai.usd.toFixed(4)} on the CI key (${result.ai.calls} calls, ${result.ai.input} in / ${result.ai.output} out tokens)`);   // lib/smoke.mjs parseLive -> the pool's dollar cap
if (result.ai?.refused) console.log(`live: AI refused ${result.ai.refused} call(s): ${result.ai.why}`);   // the row ran without AI: the pool stops and goes red (lib/pool-ci.mjs)
// The lines a smoke run reads (lib/smoke.mjs parseLive, evidence-bundle.mjs runFinished), as lib/apply-live.mjs prints them: the press, the app's own page lines, each field.
{ const output = outputOfLog(result.appLog || '', result.opened ? url : ''); if (output) console.log(output); }   // lib/smoke.mjs: the same shape npm run measure reads
console.log(`  live +${String(Math.round(result.seconds)).padStart(3)}s: watched ${Math.round(result.seconds)}s; frames in ${captureDir}`);
for (const [part, lines] of Object.entries(result.evidence)) console.log(`${part}:\n${lines.length ? lines.map(line => `  ${line}`).join('\n') : '  (none in the app log)'}`);
if (!result.tripped && !args.includes('--no-library')) {   // capture once, measure many: npm run measure re-runs a build on it offline
  const kept = keepCapture({day: new Date().toISOString().slice(0, 10), shape: flag('title') || new URL(url).host, result: {url, reached: 'a live capture'}, aiCalls: (() => { try { return fs.readFileSync(path.join(captureDir, 'ai-calls.json'), 'utf8'); } catch { return ''; } })(), captureDir, appLog: result.appLog || ''});
  if (kept) console.log(`live: capture kept in ${kept}`);
}
if (result.endedWhileDeciding) { console.log('live: ERROR ended while deciding: the time limit came while the extension was still on a step (its panel still showed it); raise the limit or find the slow step'); process.exit(1); }
if (result.tripped) process.exit(1);
