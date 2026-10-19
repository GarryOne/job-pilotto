// Ready to send, phase 1, the Worker's side (spec docs/superpowers/specs/2026-10-17-ready-to-send.md): the owner's app pushes tonight's batch (url, kit, CV, letter, contact) encrypted into R2; a container reads
// it with a one-night token, fills each form and posts only counts; the owner's page asks what is ready. The server never presses Submit: no route here accepts a submit from the container, only the owner marks one.
// Only the owner's install (env.READY_OWNER) reaches any route; READY_TO_SEND = off answers 404. The data is deleted on Done, after 24 h (sweep, from the cron) and on Delete everything.
// Counts, hosts and states stay 30 days for the morning measure; never a field value or an address. Guard: site/test/ready-to-send.test.js.
import {equal, tokenFor} from './guard.js';   // tokenFor: the night token is checked in batchOf
import {installOf} from './hosted.js';
import {open, seal} from './hosted-state.js';
import {relay} from './ready-ai.js';
import {makeLink, viaLink} from './ready-link.js';
import {fillAgain} from './ready-again.js';
import {LIVE, progress, stop} from './ready-line.js';
import {runNow} from './ready-tick.js';
import {whyOf} from './ready-why.js';
import {closeNight, morning, readyToken} from './ready-morning.js';
import {dropKept, jobsWithKept, keptPut, videoGet} from './ready-kept.js';
export {readyToken};

export const readyOn = env => env.READY_TO_SEND === 'on' && !!env.HOSTED_STATE && !!env.READY_OWNER;
const notSetUp = () => json({ok: false, error: 'Ready to send is not set up on the server yet (READY_KEK).'}, 503);   // the batch is sealed with its own Worker secret, never shared with Always on
export const MAX_JOBS = 15, MAX_BYTES = 8 * 1024 * 1024, KEEP_HOURS = 24, RUN_HOURS = 3, COUNTS_KEEP_DAYS = 30, DEFAULT_CAP_USD = 1;
export const OUTCOMES = ['prepared', 'partial', 'wall', 'no-form', 'closed', 'failed'];   // what a container may report; never "submitted"
const FACTS = ['profile', 'standard', 'search', 'cvFacts', 'knowledge'];
const HOUR = 3600 * 1000;
const label = install => `ready:${install}`, keyOf = (install, batch) => `ready/${install}/${batch}.json`;
const json = (data, status = 200) => Response.json(data, {status});
const notFound = () => new Response('Not found', {status: 404});
const deny = () => json({ok: false, error: 'unauthorized'}, 401);
const bad = error => json({ok: false, error}, 400);
const cap = env => Math.round((Number(env.READY_NIGHT_MAX_USD) > 0 ? Number(env.READY_NIGHT_MAX_USD) : DEFAULT_CAP_USD) * 1e6);
const num = value => (Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.round(Number(value)) : null);

// The owner: his install key AND the owner secret (x-ready-owner = the Worker secret READY_OWNER_SECRET). The install id travels to the site in reports and lookups, so it names the owner but proves nothing;
// without the secret set, or sent, no owner route opens (owner, 17 Oct 2026). The night token and the 10-minute link are other credentials and do not pass here.
async function ownerOf(request, env) {
  const given = request.headers.get('x-ready-owner') || '';
  if (!env.READY_OWNER_SECRET || !given || !equal(given, env.READY_OWNER_SECRET)) return null;
  const install = await installOf(request, env);
  return install && equal(install, env.READY_OWNER) ? install : null;
}
// A night token: good only while its batch is running (or capped, to read "stop") and unexpired.
export async function batchOf(env, bearer, now = new Date()) {
  const [tag, id, token] = String(bearer || '').replace(/^Bearer /, '').split('.');
  if (tag !== 'RR1' || !id || !token || !equal(token, await tokenFor(id, env, 'ready-run'))) return null;
  const row = await env.STATS.prepare('SELECT * FROM ready_batches WHERE id = ?').bind(id).first();
  return row && ['running', 'capped'].includes(row.state) && row.expires_at && Date.parse(row.expires_at) > now.getTime() ? row : null;
}
// The runner starts the night: the token the container gets. -> the token, or null when the batch is not waiting.
export async function start(env, id, now = new Date()) {
  const changed = await env.STATS.prepare("UPDATE ready_batches SET state = 'running', expires_at = ? WHERE id = ? AND state = 'queued'").bind(new Date(now.getTime() + RUN_HOURS * HOUR).toISOString(), id).run();
  return changed.meta?.changes ? readyToken(env, id) : null;
}

const readBlob = async (env, install, id) => {
  const object = await env.HOSTED_STATE.get(keyOf(install, id));
  return object ? JSON.parse(new TextDecoder().decode(await open(env, label(install), new Uint8Array(await object.arrayBuffer()), 'READY_KEK'))) : null;
};
const writeBlob = (env, install, id, data) => seal(env, label(install), new TextEncoder().encode(JSON.stringify(data)), 'READY_KEK').then(bytes => env.HOSTED_STATE.put(keyOf(install, id), bytes));
const stamp = at => at.toISOString();

// Takes the listed jobs' data out of a batch (all of them when `jobs` is null): the blob shrinks or goes, the rows keep their counts. -> how many jobs were cleared.
async function clear(env, install, id, jobs, now) {
  const data = await readBlob(env, install, id).catch(() => null);
  if (data) {
    const left = jobs ? data.jobs.filter(job => !jobs.includes(job.id)) : [];
    if (left.length) await writeBlob(env, install, id, {...data, jobs: left}); else await env.HOSTED_STATE.delete(keyOf(install, id));
  }
  await dropKept(env, install, id, jobs, now).catch(() => {});   // the kept video and hand-off (src/ready-kept.js) go with the data
  const marks = jobs ? jobs.map(() => '?').join(',') : '';
  const changed = await env.STATS.prepare(`UPDATE ready_jobs SET cleared_at = ? WHERE batch = ? AND cleared_at IS NULL${jobs ? ` AND job IN (${marks})` : ''}`).bind(stamp(now), id, ...(jobs || [])).run();
  const open_ = await env.STATS.prepare('SELECT COUNT(*) AS n FROM ready_jobs WHERE batch = ? AND cleared_at IS NULL').bind(id).first();
  if (!open_.n) { await env.STATS.prepare("UPDATE ready_batches SET state = 'deleted', deleted_at = ? WHERE id = ? AND deleted_at IS NULL").bind(stamp(now), id).run(); await closeNight(env, id); }   // nothing left to hold: the container closes its tabs
  return changed.meta?.changes || 0;
}

// What the nightly run cost, on the owner's /admin/ai-cost beside the other scheduled jobs (job id 'ready-fill').
export async function reportNight(env, row, now) {
  const usd = row.cost_micro / 1e6, calls = (await env.STATS.prepare('SELECT COUNT(*) AS n FROM ready_jobs WHERE batch = ?').bind(row.id).first()).n;
  await env.STATS.prepare(`INSERT INTO ai_cost_runs (job, run_id, day, at, usd, calls, repo, provider) VALUES ('ready-fill', ?, ?, ?, ?, ?, '', 'anthropic')
    ON CONFLICT (job, run_id) DO UPDATE SET day = excluded.day, at = excluded.at, usd = excluded.usd, calls = excluded.calls`).bind(row.id, stamp(now).slice(0, 10), stamp(now), usd, calls).run().catch(() => {});
}

// POST (the owner's install key): tonight's batch. GET (a night token): the container reads it decrypted.
async function batch(request, env, now) {
  if (request.method === 'GET') {
    const row = await batchOf(env, request.headers.get('authorization'), now);
    if (!row) return deny();
    const data = await readBlob(env, row.install, row.id);
    // Only the rows still queued: the whole night at first, one form after a Fill again (src/ready-again.js), so the others keep their results.
    const queued = new Map((await env.STATS.prepare("SELECT job, turn FROM ready_jobs WHERE batch = ? AND state = 'queued' AND cleared_at IS NULL").bind(row.id).all()).results.map(each => [each.job, each.turn]));   // turn: which press (the container fills each once)
    return json({ok: true, line: true, stop: row.state === 'capped' || !data, night: row.night, contact: data?.contact || {}, readyBy: data?.readyBy || '', facts: data?.facts || {}, jobs: (data?.jobs || []).filter(job => queued.has(job.id)).map(job => ({...job, turn: queued.get(job.id)}))});
  }
  if (request.method !== 'POST') return json({ok: false, error: 'Use GET or POST'}, 405);
  const install = await ownerOf(request, env);
  if (!install) return deny();
  if (!env.READY_KEK) return notSetUp();
  const text = await request.text();
  if (text.length > MAX_BYTES) return json({ok: false, error: 'too large'}, 413);
  let given;
  try { given = JSON.parse(text); } catch { return bad('Send JSON'); }
  const jobs = Array.isArray(given?.jobs) ? given.jobs : [];
  const good = job => typeof job?.id === 'string' && /^[\w.:-]{1,64}$/.test(job.id) && /^https:\/\/[^\s/]+/.test(String(job.url)) && String(job.url).length <= 2000;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(given?.night)) || !jobs.length || jobs.length > MAX_JOBS || !jobs.every(good) || new Set(jobs.map(job => job.id)).size !== jobs.length) return bad('bad batch');
  const old = await env.STATS.prepare('SELECT id FROM ready_batches WHERE install = ? AND night = ?').bind(install, given.night).first();
  if (old) { await clear(env, install, old.id, null, now); await env.STATS.batch([env.STATS.prepare('DELETE FROM ready_jobs WHERE batch = ?').bind(old.id), env.STATS.prepare('DELETE FROM ready_batches WHERE id = ?').bind(old.id)]); }
  const id = crypto.randomUUID();
  const kept = jobs.map(job => ({id: job.id, url: job.url, title: String(job.title || '').slice(0, 200), company: String(job.company || '').slice(0, 200), fit: num(job.fit), kit: job.kit || {}, letter: String(job.letter || ''), cv: String(job.cv || ''), letterPdf: String(job.letterPdf || '')}));
  const facts = Object.fromEntries(FACTS.map(name => [name, String(given.facts?.[name] || '').slice(0, 40000)]));   // what the AI may answer from (profile, standard answers, ...): sealed with the batch, deleted with it
  const ai = /^sk-ant-[\w-]{20,300}$/.test(String(given.ai?.key || '')) ? {key: given.ai.key} : undefined;   // the user's own Claude key (BYOK): sealed with the batch, never sent back, deleted with it
  await writeBlob(env, install, id, {ai, contact: given.contact || {}, readyBy: String(given.readyBy || '').slice(0, 5), facts, jobs: kept});
  const fillAt = Number.isFinite(Date.parse(given.fillAt)) ? new Date(given.fillAt).toISOString() : null;   // when the night should start filling (the cron starts it then); none: at the next tick
  await env.STATS.batch([env.STATS.prepare('INSERT INTO ready_batches (id, install, night, created_at, fill_at) VALUES (?, ?, ?, ?, ?)').bind(id, install, given.night, stamp(now), fillAt),
    ...kept.map(job => env.STATS.prepare('INSERT INTO ready_jobs (batch, job, host) VALUES (?, ?, ?)').bind(id, job.id, new URL(job.url).hostname))]);
  return json({ok: true, batch: id, queued: kept.length});
}

// POST (a night token): one job's outcome, counts only. "prepared" is the server's word and needs a filled form with nothing required left; the cost can stop the night.
async function result(request, env, now) {
  if (request.method !== 'POST') return json({ok: false, error: 'Use POST'}, 405);
  const row = await batchOf(env, request.headers.get('authorization'), now);
  if (!row) return deny();
  const given = await request.json().catch(() => null);
  if (!given || !OUTCOMES.includes(given.state)) return bad('bad outcome');
  const filled = num(given.filled), left = num(given.left), state = given.state === 'prepared' && !(filled > 0 && left === 0) ? 'partial' : given.state;
  const micro = num(given.costMicro) || 0;
  const changed = await env.STATS.prepare(`UPDATE ready_jobs SET state = ?, filled = ?, left_empty = ?, human_check = ?, wall = ?, ms = ?, cost_micro = cost_micro + ?, at = ?, step = NULL, step_n = NULL, again_from = NULL
    WHERE batch = ? AND job = ? AND cleared_at IS NULL AND state IN ${LIVE}`).bind(state, filled, left, given.humanCheck ? 1 : 0, String(given.wall || '').slice(0, 40), num(given.ms), micro, stamp(now), row.id, String(given.job)).run();
  if (!changed.meta?.changes) {   // a form the owner stopped (src/ready-line.js) keeps what it was put back to; an unknown one is refused
    const known = await env.STATS.prepare('SELECT 1 AS n FROM ready_jobs WHERE batch = ? AND job = ?').bind(row.id, String(given.job)).first();
    return known ? json({ok: true, dropped: true, stop: false}) : json({ok: false, error: 'unknown job'}, 404);
  }
  const total = row.cost_micro + micro, capped = total >= cap(env);
  const waiting = (await env.STATS.prepare(`SELECT COUNT(*) AS n FROM ready_jobs WHERE batch = ? AND state IN ${LIVE}`).bind(row.id).first()).n;
  const next = capped ? 'capped' : waiting ? row.state : 'finished';
  await env.STATS.prepare('UPDATE ready_batches SET cost_micro = ?, state = ?, finished_at = ? WHERE id = ?').bind(total, next, next === row.state ? null : stamp(now), row.id).run();
  if (next !== row.state) await reportNight(env, {...row, cost_micro: total}, now);
  return json({ok: true, stop: next !== 'running'});
}

// POST (a night token): one model call for the night's AI answers (src/ready-ai.js); its cost counts toward the night's cap.
async function aiCall(request, env, now) {
  if (request.method !== 'POST') return json({ok: false, error: 'Use POST'}, 405);
  const row = await batchOf(env, request.headers.get('authorization'), now);
  if (!row) return deny();
  const byok = (await readBlob(env, row.install, row.id).catch(() => null))?.ai?.key || '';
  const stopped = () => env.STATS.prepare('UPDATE ready_batches SET ai_stopped = 1 WHERE id = ?').bind(row.id).run();
  return relay(request, env, row, async micro => {
    const total = (await env.STATS.prepare('SELECT cost_micro FROM ready_batches WHERE id = ?').bind(row.id).first()).cost_micro + micro;
    const capped = total >= cap(env);
    await env.STATS.prepare('UPDATE ready_batches SET cost_micro = ?, state = ? WHERE id = ?').bind(total, capped ? 'capped' : row.state, row.id).run();
    if (capped) await reportNight(env, {...row, cost_micro: total}, now);
  }, {byok, stopped, now});
}

// The owner's calls: Done (a job's data deleted), "I submitted it" (his word, from the app's Applied status), the morning's rows, the measure, Delete everything.
async function mine(request, env, now, sub) {
  const linked = sub === 'submitted' && !(await installOf(request, env)) ? await viaLink(request, env, now) : null;   // the page's "I submitted it": the link, for its own job only
  const install = linked || await ownerOf(request, env);
  if (!install) return deny();
  const latest = job => env.STATS.prepare(`SELECT b.id FROM ready_jobs j JOIN ready_batches b ON b.id = j.batch WHERE b.install = ? AND j.job = ? ORDER BY b.created_at DESC LIMIT 1`).bind(install, job).first();
  if (sub === 'data' && request.method === 'DELETE') {
    let objects = 0;
    for (const item of (await env.HOSTED_STATE.list({prefix: `ready/${install}/`})).objects || []) { await env.HOSTED_STATE.delete(item.key); objects++; }
    const {results} = await env.STATS.prepare('SELECT id FROM ready_batches WHERE install = ? AND deleted_at IS NULL').bind(install).all();
    let jobs = 0;
    for (const batch_ of results) jobs += await clear(env, install, batch_.id, null, now);
    return json({ok: true, receipt: {objects, jobs}});
  }
  if (sub === 'done' || sub === 'submitted') {
    if (request.method !== 'POST') return json({ok: false, error: 'Use POST'}, 405);
    const given = await request.json().catch(() => null), job = String(given?.job || ''), found = job && await latest(job);
    if (linked && job !== new URL(request.url).searchParams.get('job')) return deny();
    if (!found) return json({ok: false, error: 'unknown job'}, 404);
    if (sub === 'done') return json({ok: true, cleared: await clear(env, install, found.id, [job], now)});
    await env.STATS.prepare('UPDATE ready_jobs SET submitted_at = COALESCE(submitted_at, ?) WHERE batch = ? AND job = ?').bind(stamp(now), found.id, job).run();
    return json({ok: true});
  }
  if (request.method !== 'GET') return json({ok: false, error: 'Use GET'}, 405);
  if (sub === 'state') {
    const night = new URL(request.url).searchParams.get('night');
    const row = night ? await env.STATS.prepare('SELECT * FROM ready_batches WHERE install = ? AND night = ?').bind(install, night).first()
      : await env.STATS.prepare('SELECT * FROM ready_batches WHERE install = ? ORDER BY night DESC LIMIT 1').bind(install).first();
    if (!row) return json({ok: true, batch: null, jobs: []});
    const {results} = await env.STATS.prepare('SELECT job, host, state, filled, left_empty, human_check, wall, ms, submitted_at, cleared_at, step, step_n, started_at FROM ready_jobs WHERE batch = ? ORDER BY job').bind(row.id).all();
    const videos = await jobsWithKept(env, install, 'video', row.id).catch(() => new Set());   // Watch the fill: which rows have the night's video
    return json({ok: true, batch: {night: row.night, state: row.state, costUsd: row.cost_micro / 1e6, expiresAt: row.expires_at, aiStopped: !!row.ai_stopped, why: whyOf(env, row, results, now)}, jobs: results.map(job => ({...job, video: videos.has(job.job)}))});
  }
  if (sub === 'report') {   // the morning line: prepared / reached a form / filled completely / he submitted, per night
    const {results} = await env.STATS.prepare(`SELECT b.night, b.cost_micro, COUNT(*) AS prepared_for, SUM(j.state IN ('prepared','partial')) AS reached, SUM(j.state = 'prepared') AS complete,
      SUM(j.submitted_at IS NOT NULL) AS submitted FROM ready_batches b JOIN ready_jobs j ON j.batch = b.id WHERE b.install = ? GROUP BY b.id ORDER BY b.night DESC LIMIT 30`).bind(install).all();
    return json({ok: true, nights: results.map(r => ({night: r.night, costUsd: r.cost_micro / 1e6, queued: r.prepared_for, reached: r.reached || 0, complete: r.complete || 0, submitted: r.submitted || 0}))});
  }
  return notFound();
}

// The cron: batches older than a day lose their data, counts older than 30 days go. -> {swept, purged}
export async function sweep(env, now = new Date()) {
  const out = {swept: 0, purged: 0};
  if (!readyOn(env) || !env.STATS) return out;
  const {results} = await env.STATS.prepare('SELECT id, install FROM ready_batches WHERE created_at < ? AND deleted_at IS NULL').bind(stamp(new Date(now.getTime() - KEEP_HOURS * HOUR))).all();
  for (const row of results) { await clear(env, row.install, row.id, null, now); out.swept++; }
  const old = stamp(new Date(now.getTime() - COUNTS_KEEP_DAYS * 24 * HOUR));
  await env.STATS.prepare('DELETE FROM ready_jobs WHERE batch IN (SELECT id FROM ready_batches WHERE created_at < ?)').bind(old).run();
  out.purged = (await env.STATS.prepare('DELETE FROM ready_batches WHERE created_at < ?').bind(old).run()).meta?.changes || 0;
  return out;
}

// /api/ready/<batch|result|ai|video|live|handoff|held|link|again|progress|stop|run|done|submitted|state|report|data>
export async function ready(request, env, now = new Date()) {
  if (!readyOn(env)) return notFound();
  const sub = new URL(request.url).pathname.replace(/^\/api\/ready\/?/, '');
  if (sub === 'batch') return batch(request, env, now);
  if (sub === 'result') return result(request, env, now);
  if (sub === 'ai') return aiCall(request, env, now);
  if (sub === 'video' || (sub === 'handoff' && request.method === 'PUT')) {   // src/ready-kept.js: the night's container puts a form's video (Watch the fill) or its hand-off (Open in my browser)
    if (request.method === 'PUT') { const row = await batchOf(env, request.headers.get('authorization'), now); return row ? (env.READY_KEK ? keptPut(request, env, row, sub, now) : notSetUp()) : deny(); }
    const install = await ownerOf(request, env);
    return install ? videoGet(request, env, install) : deny();
  }
  if (['live', 'handoff', 'held'].includes(sub)) { const install = await ownerOf(request, env) || (sub === 'live' ? await viaLink(request, env, now) : null); return install ? morning(request, env, install, sub) : deny(); }   // the live view also opens with the 10-minute link   // the morning: the container's tabs (src/ready-morning.js)
  if (sub === 'link') {   // the owner's app asks for the 10-minute link to one form's live view
    const install = await ownerOf(request, env);
    if (!install) return deny();
    if (request.method !== 'POST') return json({ok: false, error: 'Use POST'}, 405);
    const job = String((await request.json().catch(() => null))?.job || '');
    return /^[\w.:-]{1,64}$/.test(job) ? json({ok: true, ...(await makeLink(env, job, new URL(request.url).origin, now))}) : bad('bad job');
  }
  if (sub === 'again') {   // a row's Fill again: that form, from the night's own copy (src/ready-again.js)
    const install = await ownerOf(request, env);
    if (!install) return deny();
    if (request.method !== 'POST') return json({ok: false, error: 'Use POST'}, 405);
    const job = String((await request.json().catch(() => null))?.job || '');
    if (!/^[\w.:-]{1,64}$/.test(job)) return bad('bad job');
    const done = await fillAgain(env, install, job, now);
    return json(done.body, done.status);
  }
  if (sub === 'progress') {   // the container: the step a form is on (src/ready-line.js); `stop` when the owner stopped it
    const night = await batchOf(env, request.headers.get('authorization'), now);
    if (!night) return deny();
    if (request.method !== 'POST') return json({ok: false, error: 'Use POST'}, 405);
    const done = await progress(env, night, await request.json().catch(() => null), now);
    return json(done.body, done.status);
  }
  if (sub === 'stop') {   // the owner stops one form ({job}) or the whole night ({})
    const install = await ownerOf(request, env);
    if (!install) return deny();
    if (request.method !== 'POST') return json({ok: false, error: 'Use POST'}, 405);
    const job = String((await request.json().catch(() => null))?.job || '');
    if (job && !/^[\w.:-]{1,64}$/.test(job)) return bad('bad job');
    const done = await stop(env, install, job, now);
    return json(done.body, done.status);
  }
  if (sub === 'run') {   // the owner starts his queued night now (a manual test; the cron would start it at its fill time)
    const install = await ownerOf(request, env);
    if (!install) return deny();
    if (request.method !== 'POST') return json({ok: false, error: 'Use POST'}, 405);
    const done = await runNow(env, install, now);
    return json(done.body, done.status);
  }
  return mine(request, env, now, sub);
}
