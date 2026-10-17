// The night's run (spec docs/superpowers/specs/2026-10-17-ready-to-send.md): read the batch with the night token, start ONE browser with the night's copy of the extension and the stand-in app, fill each job in its own tab, one after the other,
// post only counts to the Worker after each (it can answer "stop": the night's cost cap), and keep every filled tab open for the morning. Never presses Submit or an account button (extension-copy.mjs, no-submit.mjs).
// Counts only leave this file: no field value, no address in a log. Guard: desktop/test/ready-fill.test.js; the fixture proof is hosted/ready-fill/proof.mjs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {copyForNight} from './extension-copy.mjs';
import {setExtensionStorage} from './extension-storage.mjs';
import {fillJob} from './fill-job.mjs';
import {answererFor} from './night-ai.mjs';
import {net} from './no-submit.mjs';
import {createStandIn} from './stand-in.mjs';

export const EXTENSION_DIR = process.env.EXTENSION_DIR || path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'extension');
// Pure: what a job cost us, micro-USD: the container's seconds (standard-1: 4 GiB memory + 8 GB disk + CPU, measured ≈ $0.000012 a second) plus the AI the extension reported.
export const costMicro = (ms, usd = 0) => Math.round((Number(ms) || 0) / 1000 * 12 + (Number(usd) || 0) * 1e6);

// Why a night failed, for the owner's /state (behind the night token) and the log: the error's first words, with any address cut out (counts and words only).
export const why = error => String(error?.message || error).replace(/\b(?:https?|wss?):\/\/\S+/g, '<address>').split('\n')[0].slice(0, 160);

async function post(fetchImpl, site, token, route, body) {
  const response = await fetchImpl(`${site}/api/ready/${route}`, {method: body ? 'POST' : 'GET', headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'}, body: body ? JSON.stringify(body) : undefined});
  return response.json().catch(() => ({}));
}

// chromium: Playwright's (main.mjs passes `playwright`'s; the fixture proof passes the desktop's), so this file loads without a browser package. -> {held: Map(jobId -> page), context, close()} once every job has been tried (the pages stay open).
export async function runNight({chromium, site, token, fetchImpl = fetch, log = () => {}, fillSeconds = 120, extraArgs = [], launchOptions = {}}) {   // extraArgs/launchOptions: the fixture proof's host rules and certificate (proof.mjs)
  const batch = await post(fetchImpl, site, token, 'batch');
  const held = new Map();
  if (!batch.ok || batch.stop || !batch.jobs?.length) { log('nothing to do', {stop: !!batch.stop}); return {held, close: async () => {}}; }
  const standIn = await createStandIn(batch, {answer: await answererFor({batch, site, token, fetchImpl})});
  const copy = copyForNight(standIn.port, EXTENSION_DIR);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-night-'));
  const context = await chromium.launchPersistentContext(profile, {headless: false, locale: 'en-US', ignoreDefaultArgs: ['--disable-extensions', '--disable-popup-blocking'], timeout: 90000, ...launchOptions,
    args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${copy}`, `--load-extension=${copy}`, '--no-first-run', '--no-default-browser-check', ...extraArgs]});
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', {timeout: 30000});
  await setExtensionStorage(worker, {workerUrl: `http://127.0.0.1:${standIn.port}`, token: 'night'});  
  const guard = await net(context);
  const close = async () => { await context.close().catch(() => {}); await standIn.close().catch(() => {}); fs.rmSync(profile, {recursive: true, force: true}); };
  for (const job of batch.jobs) {
    const done = await fillJob({context, standIn, job, fillSeconds}).catch(error => ({state: 'failed', wall: 'error', filled: 0, left: 0, humanCheck: false, ms: 0, page: null, error: String(error).slice(0, 80)}));
    if (done.page && ['prepared', 'partial'].includes(done.state)) held.set(job.id, done.page); else await done.page?.close().catch(() => {});   // only a filled form is worth holding
    const usd = standIn.outcome(job.url)?.usd || 0;
    const answer = await post(fetchImpl, site, token, 'result', {job: job.id, state: done.state, filled: done.filled, left: done.left, humanCheck: done.humanCheck, wall: done.wall, ms: done.ms, costMicro: costMicro(done.ms, usd)});
    log('job', {id: job.id, state: done.state, filled: done.filled, left: done.left, ms: done.ms, blocked: guard.blocked.length});
    if (answer.stop) { log('stopped by the Worker (cost cap or finished)'); break; }
  }
  return {held, context, guard, standIn, close};
}
