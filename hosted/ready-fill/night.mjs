// The night's run (spec docs/superpowers/specs/2026-10-17-ready-to-send.md): read the batch with the night token, start ONE browser with the night's copy of the extension and the stand-in app, fill each job in its own tab, one after the other,
// post only counts to the Worker after each (it can answer "stop": the night's cost cap), and keep every filled tab open for the morning. Never presses Submit or an account button (extension-copy.mjs, no-submit.mjs).
// Counts only leave this file: no field value, no address in a log. Guard: desktop/test/ready-fill.test.js; the fixture proof is hosted/ready-fill/proof.mjs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {copyForNight} from './extension-copy.mjs';
import {setExtensionStorage} from './extension-storage.mjs';
import {fillJob} from './fill-job.mjs';
import {discard} from './fill-video.mjs';
import {handoff as handoffOf} from './live.mjs';
import {answererFor} from './night-ai.mjs';
import {net} from './no-submit.mjs';
import {createStandIn} from './stand-in.mjs';

export const EXTENSION_DIR = process.env.EXTENSION_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'extension');
// Pure: what a job cost us, micro-USD: the container's seconds (standard-1: 4 GiB memory + 8 GB disk + CPU, measured ≈ $0.000012 a second) plus the AI the extension reported.
export const costMicro = (ms, usd = 0) => Math.round((Number(ms) || 0) / 1000 * 12 + (Number(usd) || 0) * 1e6);

// Why a night failed, for the owner's /state (behind the night token) and the log: the error's first words, with any address cut out (counts and words only).
export const why = error => String(error?.message || error).replace(/\b(?:https?|wss?):\/\/\S+/g, '<address>').split('\n')[0].slice(0, 160);

// The fill's video to the site (Watch the fill): sealed there, deleted with the job's data. A failed upload loses only the video. -> the HTTP status, or 0.
export async function sendVideo(fetchImpl, site, token, job, video) {
  if (!video?.path) return 0;
  try {
    const response = await fetchImpl(`${site}/api/ready/video?job=${encodeURIComponent(job)}&secs=${video.secs}`, {method: 'PUT', headers: {authorization: `Bearer ${token}`, 'content-type': 'video/webm'}, body: fs.readFileSync(video.path)});
    return response.status;
  } catch { return 0; } finally { discard(video.path); }
}

// A held form's hand-off to the site (Open in my browser after the container is gone; owner, 18 Oct 2026: "Yes, sealed, 24 h max"): the page, its storage and its fields,
// sealed there and deleted with the form's data. Read now, while the tab is fresh; a failed read or upload loses only the stored copy. -> the HTTP status, or 0.
export async function sendHandoff(fetchImpl, site, token, job, page, read = handoffOf) {
  if (!page) return 0;
  try {
    const body = JSON.stringify(await read(page));
    const response = await fetchImpl(`${site}/api/ready/handoff?job=${encodeURIComponent(job)}`, {method: 'PUT', headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'}, body});
    return response.status;
  } catch { return 0; }
}

// Pure: the job's log line: counts, words and upload statuses only, never a field value, an address or a cookie.
export const jobLine = ({id, done, blocked, video, handoff}) => ({id, state: done.state, filled: done.filled, left: done.left, ms: done.ms, blocked,
  video: done.video ? {bytes: done.video.bytes, secs: done.video.secs, sent: video} : null, handoff});

// Pure: a container holding no night (a fresh one the site woke after a deploy, or one already closed) answers "gone" (410) on the morning's calls, so the runner stops it again.
export const gone = (night, status) => !night && status.state === 'idle';

async function post(fetchImpl, site, token, route, body) {
  const response = await fetchImpl(`${site}/api/ready/${route}`, {method: body ? 'POST' : 'GET', headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'}, body: body ? JSON.stringify(body) : undefined});
  return response.json().catch(() => ({}));
}

// chromium: Playwright's (main.mjs passes `playwright`'s; the fixture proof passes the desktop's), so this file loads without a browser package. -> {held: Map(jobId -> page), context, close()} once every job has been tried (the pages stay open).
export async function runNight({chromium, site, token, fetchImpl = fetch, log = () => {}, fillSeconds = 120, extraArgs = [], launchOptions = {}, record = null}) {   // extraArgs/launchOptions: the fixture proof's host rules and certificate (proof.mjs)
  const batch = await post(fetchImpl, site, token, 'batch');
  const held = new Map(), told = new Set();   // told: the jobs whose result the site already has
  if (!batch.ok || batch.stop || !batch.jobs?.length) { log('nothing to do', {stop: !!batch.stop}); return {held, close: async () => {}}; }
  try { return await fillAll({told, batch, chromium, site, token, fetchImpl, log, fillSeconds, extraArgs, launchOptions, held, record}); }
  catch (error) {   // the night could not start or stopped: each job not yet told is told, so the card says so at once instead of "waiting" until the night's end
    for (const job of batch.jobs.filter(job => !held.has(job.id) && !told.has(job.id))) await post(fetchImpl, site, token, 'result', {job: job.id, state: 'failed', filled: 0, left: 0, humanCheck: false, wall: NIGHT_FAILED, ms: 0, costMicro: 0}).catch(() => {});
    throw error;
  }
}

export const NIGHT_FAILED = 'the night could not start';   // the word the card shows beside "could not fill"; the error itself stays in the container's /state and log
async function fillAll({told, batch, chromium, site, token, fetchImpl, log, fillSeconds, extraArgs, launchOptions, held, record}) {
  const standIn = await createStandIn(batch, {answer: await answererFor({batch, site, token, fetchImpl})});
  let profile = '', context = null;
  try {   // a setup that fails closes what it opened (the stand-in's server, the browser, the profile folder), so the process can end
    const copy = copyForNight(standIn.port, EXTENSION_DIR);
    profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-night-'));
    context = await chromium.launchPersistentContext(profile, {headless: false, locale: 'en-US', ignoreDefaultArgs: ['--disable-extensions', '--disable-popup-blocking'], timeout: 90000, ...launchOptions,
      args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${copy}`, `--load-extension=${copy}`, '--no-first-run', '--no-default-browser-check', ...extraArgs]});
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', {timeout: 30000});
    await setExtensionStorage(worker, {workerUrl: `http://127.0.0.1:${standIn.port}`, token: 'night'});  
  } catch (error) {
    await context?.close().catch(() => {}); await standIn.close().catch(() => {}); if (profile) fs.rmSync(profile, {recursive: true, force: true});
    throw error;
  }
  const guard = await net(context);
  const close = async () => { await context.close().catch(() => {}); await standIn.close().catch(() => {}); fs.rmSync(profile, {recursive: true, force: true}); };
  for (const job of batch.jobs) {
    const done = await fillJob({context, standIn, job, fillSeconds, ...(record ? {record} : {})}).catch(error => ({state: 'failed', wall: 'error', filled: 0, left: 0, humanCheck: false, ms: 0, page: null, video: null, error: String(error).slice(0, 80)}));
    if (done.page && ['prepared', 'partial'].includes(done.state)) held.set(job.id, done.page); else await done.page?.close().catch(() => {});   // only a filled form is worth holding
    const usd = standIn.outcome(job.url)?.usd || 0;
    const video = await sendVideo(fetchImpl, site, token, job.id, done.video);   // before the result: the last result ends the night, and its token with it
    const handoff = held.has(job.id) ? await sendHandoff(fetchImpl, site, token, job.id, done.page) : 0;   // likewise before the result
    const answer = await post(fetchImpl, site, token, 'result', {job: job.id, state: done.state, filled: done.filled, left: done.left, humanCheck: done.humanCheck, wall: done.wall, ms: done.ms, costMicro: costMicro(done.ms, usd)});
    told.add(job.id);
    log('job', jobLine({id: job.id, done, blocked: guard.blocked.length, video, handoff}));
    if (answer.stop) { log('stopped by the Worker (cost cap or finished)'); break; }
  }
  return {held, context, guard, standIn, close};
}
