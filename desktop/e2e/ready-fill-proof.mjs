// Ready to send: the night's filler (hosted/ready-fill/) run for real against the e2e fixture forms, with a fake Worker. It proves what the unit tests cannot: the real extension, in Chromium, fills three fixture forms
// from a batch (kit, CV, contact) through the stand-in app, stops before Submit (the fixtures log any Submit that was clicked), reports counts only, and the held tabs give a hand-off. Run: `node ready-fill-proof.mjs` (fictional data only).
// Prints one line per job and a JSON summary (also to $1 when given): states, counts, seconds, browser memory. Spec private spec job-pilotto-internal:docs/specs/2026-10-17-ready-to-send.md, PR 2.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright-core';
import {handoff} from '../../hosted/ready-fill/live.mjs';
import {runNight} from '../../hosted/ready-fill/night.mjs';
import {CONTACT} from './lib/apply-fixtures.mjs';
import {FORMS, ONEPAGE, hostRules, startForms} from './lib/forms.mjs';
import {FIXTURE_CV} from './lib/real-extension.mjs';

const forms = await startForms();
const cv = fs.readFileSync(FIXTURE_CV).toString('base64');
const chosen = [['greenhouse', FORMS.greenhouse], ['lever', FORMS.lever], ['one-page', ONEPAGE]];
const jobs = chosen.map(([id, form]) => ({id, url: form.url, title: form.title, company: form.company, fit: 80, kit: {answers: form.kit || []}, cv, letterPdf: '', letter: ''}));
const results = [];
const worker = http.createServer((request, response) => {   // the Worker's two routes the night uses
  let body = ''; request.on('data', chunk => { body += chunk; });
  request.on('end', () => {
    response.writeHead(200, {'content-type': 'application/json'});
    if (request.url.endsWith('/batch')) return response.end(JSON.stringify({ok: true, stop: false, night: '2026-10-18', contact: CONTACT, jobs}));
    const given = JSON.parse(body || '{}'); results.push(given);
    response.end(JSON.stringify({ok: true, stop: results.length >= jobs.length}));
  });
});
await new Promise(resolve => worker.listen(0, '127.0.0.1', resolve));
const site = `http://127.0.0.1:${worker.address().port}`;
const memoryMb = () => { try { return Math.round(execFileSync('sh', ['-c', "ps -axo rss=,command= | grep -E 'jp-night-' | grep -v grep | awk '{s+=$1} END {print s}'"]).toString().trim() / 1024); } catch { return 0; } };

const started = Date.now();
const night = await runNight({chromium, site, token: 'RR1.proof.token', fillSeconds: 90, log: (what, data) => console.log(what, JSON.stringify(data || {})),
  extraArgs: [`--host-resolver-rules=${hostRules(forms.port)}`, '--ignore-certificate-errors'], launchOptions: {ignoreHTTPSErrors: true}});
const peakMb = memoryMb();
const summary = {jobs: results.map(({job, state, filled, left, ms, humanCheck, wall}) => ({job, state, filled, left, seconds: Math.round(ms / 1000), humanCheck, wall})),
  totalSeconds: Math.round((Date.now() - started) / 1000), browserMemoryMb: peakMb, held: [...night.held.keys()], blocked: night.guard?.blocked || [],
  submitsTouched: forms.fired.filter(item => /submit/i.test(JSON.stringify(item))).length, formPosts: forms.posts.length};
for (const id of night.held.keys()) {   // the hand-off of each held tab: address, storage and the field snapshot (counts only here)
  const taken = await handoff(night.held.get(id));
  (summary.handoff ||= {})[id] = {fields: taken.snapshot.fields.length, withValue: taken.snapshot.fields.filter(f => f.value && f.value !== false).length, files: taken.snapshot.files.filter(f => f.name).length, cookies: taken.storage.cookies.length};
}
console.log(JSON.stringify(summary, null, 1));
if (process.argv[2]) fs.writeFileSync(path.resolve(process.argv[2]), JSON.stringify(summary, null, 1));
await night.close(); await forms.close(); worker.close();
process.exit(summary.submitsTouched || summary.formPosts ? 1 : 0);
