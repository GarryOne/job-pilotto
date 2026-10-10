// The shared recipe library for the self-improving form filler (Notion: "Self-improving form filling: design & plan").
//   POST /api/install-token   an app asks for its token (an HMAC of its install id); limited per network address per day.
//   POST /api/recipes/lookup  the app lists the fingerprints of the controls on the form in front of it and gets back only the
//                       recipes for those (running ones, honouring the canary share). Nobody can download the library whole: a
//                       recipe can only be asked for by presenting the structure it fits, and the hash space cannot be walked.
//   GET  /api/recipes   the owner's key only: the whole running set, for the dashboard.
//   GET  /api/recipes/targets  the owner's key only: the failing controls that have no recipe yet, with samples, for the private proposer.
//   PUT  /api/recipes   the owner's key (same as /stats): the proposer or the owner adds a recipe, or changes its status.
//   POST /api/controls  from apps: scrubbed control structures (to propose recipes from) and how the operators fared (the canary's
//                       evidence). Product data only: no user data, no text, no answers.
// evaluateCanary (daily) promotes a canary that works and halts one that fails, with no one watching.
import {familyOfInstall} from './engines.js';
import {validateRecipe} from '../../extension/recipe-schema.js';
import {betaOf, reaches, staged} from './canary-reach.js';
import {cleanCard} from '../../extension/fill-card.js';
import {recordUse} from './hostuse.js';
import {hashed} from './pool.js';
import {isOwner} from './stats.js';
import {authorize, digestOf, equal, flag, honeypotAmong, revoke, tokenFor} from './guard.js';
import {storeProposals as storeAliasProposals, storeUse as storeAliasUse} from './aliases.js';
import {store as storeIntelligence} from './intelligence.js';
import {store as storeKnowledge} from './knowledge.js';

const STATUSES = ['candidate', 'canary', 'verified', 'disabled'];
const STEPS = [5, 25, 100];                  // a canary's rollout, in order
const MIN_FAIL_CHECK = 20, HALT_ABOVE = 0.25;   // enough attempts to judge, and the failure rate that stops a recipe
const MIN_PROMOTE = 50, PROMOTE_BELOW = 0.05;   // enough attempts to trust it, and the failure rate that lets it grow
const SAMPLES_PER_FINGERPRINT = 3, MAX_SKELETON = 6000, PER_INSTALL_PER_DAY = 500;
const day = date => date.toISOString().slice(0, 10);
const text = (value, max) => String(value ?? '').replace(/[\u0000-\u001f<>`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

const digest = digestOf;

// ---- GET / PUT /api/recipes ----
export async function recipes(request, env, now = new Date()) {
  if (!env.STATS) return Response.json({ok: false, error: 'not configured'}, {status: 503});
  if (request.method === 'GET') {
    if (!await isOwner(request, env)) return new Response('Not found', {status: 404});
    const wanted = new URL(request.url).searchParams.get('status') === 'candidate' ? ['candidate'] : ['canary', 'verified'];
    const rows = (await env.STATS.prepare(`SELECT fingerprint, version, status, rollout, body FROM recipes WHERE status IN (${wanted.map(() => '?').join(', ')})
      ORDER BY fingerprint, version DESC`).bind(...wanted).all()).results || [];
    const seen = new Set(), out = [];
    for (const row of rows) {
      if (seen.has(row.fingerprint)) continue;   // the newest running version only
      seen.add(row.fingerprint);
      const checked = validateRecipe(JSON.parse(row.body));
      if (checked.ok) out.push({...checked.recipe, status: row.status, rollout: row.status === 'verified' ? 100 : row.rollout});
    }
    const body = JSON.stringify({recipes: out});
    const tag = `"${await digest(body)}"`;
    const headers = {'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', ETag: tag};
    if (request.headers.get('If-None-Match') === tag) return new Response(null, {status: 304, headers});
    return new Response(JSON.stringify({generated: now.toISOString(), recipes: out}), {headers});
  }
  if (request.method !== 'PUT') return new Response('Method not allowed', {status: 405});
  if (!await isOwner(request, env)) return new Response('Not found', {status: 404});
  const input = await request.json().catch(() => ({}));
  const checked = validateRecipe(input.recipe);
  if (!checked.ok) return Response.json({ok: false, error: checked.error}, {status: 400});
  const status = STATUSES.includes(input.status) ? input.status : 'candidate';
  const rollout = status === 'verified' ? 100 : status === 'canary' ? Math.max(1, Math.min(100, Math.round(Number(input.rollout)) || STEPS[0])) : 0;
  const when = now.toISOString();
  await env.STATS.prepare(`INSERT INTO recipes (fingerprint, version, status, rollout, body, source, note, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (fingerprint, version) DO UPDATE SET status = excluded.status, rollout = excluded.rollout,
    body = excluded.body, note = excluded.note, updated_at = excluded.updated_at`)
    .bind(checked.recipe.fingerprint, checked.recipe.version, status, rollout, JSON.stringify(checked.recipe), text(input.source || 'owner', 20), text(input.note, 200), when, when).run();
  return Response.json({ok: true, status, rollout});
}

// ---- access: a token per install, and lookups by fingerprint ----
// Recipe tokens are scarce (a token is a lookup quota); index tokens are plentiful because Always-on runs share GitHub's network
// addresses and one download is the whole index anyway. A token only opens what it was minted for.
const MINTS_PER_ADDRESS_PER_DAY = {recipes: 10, index: 300}, LOOKUPS_PER_INSTALL_PER_DAY = 2000, MAX_LOOKUP = 30;

// POST /api/install-token {install, purpose?}: the app's token ('recipes' by default, or 'index' for the employer index). New tokens are limited per network address, so minting installs to
// raise the lookup quota is slow; the quota is per install.
export async function installToken(request, env, now = new Date()) {
  if (request.method !== 'POST') return new Response('Method not allowed', {status: 405});
  const body = await request.json().catch(() => ({}));
  const install = String(body.install || '');
  if (!/^[\w-]{8,64}$/.test(install)) return Response.json({ok: false, error: 'bad install'}, {status: 400});
  const purpose = body.purpose === 'index' ? 'index' : 'recipes';
  const kv = env.WAITLIST;
  if (kv) {
    const address = await digest(request.headers.get('CF-Connecting-IP') || 'unknown');
    const key = `${purpose}-mint:${address}:${day(now)}`;
    const used = Number(await kv.get(key)) || 0;
    if (used >= MINTS_PER_ADDRESS_PER_DAY[purpose]) { await flag(env, 'mint', address, purpose, now); return Response.json({ok: false, error: 'limit reached for today'}, {status: 429}); }
    await kv.put(key, String(used + 1), {expirationTtl: 2 * 86400});
  }
  return Response.json({ok: true, token: await tokenFor(install, env, purpose)});
}

// POST /api/recipes/lookup {install, fingerprints: [...]} with Authorization: Bearer <token>.
export async function lookup(request, env, now = new Date()) {
  if (request.method !== 'POST') return new Response('Method not allowed', {status: 405});
  if (!env.STATS) return Response.json({ok: false, error: 'not configured'}, {status: 503});
  const body = await request.json().catch(() => ({}));
  const install = String(body.install || '');
  const bearer = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const access = await authorize(env, install, bearer, 'recipes');
  if (!access.ok) return Response.json({ok: false, error: 'unauthorized'}, {status: 401});
  const asked = [...new Set((Array.isArray(body.fingerprints) ? body.fingerprints : []).map(String).filter(fp => /^[a-z0-9]{6,16}$/.test(fp)))].slice(0, MAX_LOOKUP);
  const kv = env.WAITLIST, key = `recipes-lookup:${install}:${day(now)}`;
  const used = kv ? Number(await kv.get(key)) || 0 : 0;
  // A decoy fingerprint no real form produces: whoever asks is scanning the library. Answer as if nothing was found; revoke quietly.
  const decoy = await honeypotAmong(env, asked);
  if (decoy) { await flag(env, 'honeypot', access.who, decoy, now); await revoke(env, access.who, 'asked for a honeypot', now); return Response.json({ok: true, recipes: []}, {headers: {'Cache-Control': 'private, no-store'}}); }
  if (used + asked.length > LOOKUPS_PER_INSTALL_PER_DAY) { await flag(env, 'quota', access.who, 'recipe lookups', now); return Response.json({ok: false, error: 'limit reached for today'}, {status: 429}); }
  if (kv && asked.length) await kv.put(key, String(used + asked.length), {expirationTtl: 2 * 86400});
  const out = [];
  for (const fingerprint of asked) {
    const row = await env.STATS.prepare(`SELECT version, status, rollout, body FROM recipes WHERE fingerprint = ? AND status IN ('canary', 'verified')
      ORDER BY version DESC LIMIT 1`).bind(fingerprint).first();
    if (!row) continue;
    const checked = validateRecipe(JSON.parse(row.body));
    const stage = staged(env), rollout = row.status === 'verified' || !stage ? 100 : row.rollout;
    if (checked.ok && reaches(row, install, {beta: betaOf(request), stage})) out.push({...checked.recipe, rollout});   // canary-reach.js: staged rollout off for now
  }
  return Response.json({ok: true, recipes: out}, {headers: {'Cache-Control': 'private, no-store'}});
}

// ---- POST /api/controls ----
// A skeleton rebuilt from only what a skeleton may hold (extension/page/skeleton.js): tags, attribute NAMES with short values,
// class words, children. Whatever else a client sends, text included, is dropped here.
const ATTR_NAMES = new Set(['role', 'type', 'aria-pressed', 'aria-checked', 'aria-expanded', 'aria-haspopup', 'aria-autocomplete',
  'aria-selected', 'aria-multiselectable', 'aria-orientation', 'contenteditable', 'required', 'multiple', 'inputmode']);
export function cleanSkeleton(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 4) return null;
  const tag = String(node.t || '');
  if (!/^[a-z0-9-]{1,24}$/.test(tag)) return null;
  const a = {};
  for (const [name, value] of Object.entries(node.a && typeof node.a === 'object' ? node.a : {})) {
    if (ATTR_NAMES.has(name) && /^[\w-]{0,24}$/.test(String(value))) a[name] = String(value);
  }
  const c = (Array.isArray(node.c) ? node.c : []).filter(word => /^[a-z0-9_-]{3,40}$/.test(String(word))).slice(0, 6).map(String);
  const k = (Array.isArray(node.k) ? node.k : []).slice(0, 12).map(child => cleanSkeleton(child, depth + 1)).filter(Boolean);
  return {t: tag, a, c, k};
}

export async function controls(request, env, now = new Date()) {
  if (request.method !== 'POST') return new Response('Method not allowed', {status: 405});
  if (!env.STATS) return Response.json({ok: false, error: 'not configured'}, {status: 503});
  const body = await request.json().catch(() => ({}));
  const install = String(body.install || '');
  if (!/^[\w-]{8,64}$/.test(install)) return Response.json({ok: false, error: 'bad install'}, {status: 400});
  const samples = (Array.isArray(body.samples) ? body.samples : []).slice(0, 10);
  const outcomes = (Array.isArray(body.outcomes) ? body.outcomes : []).slice(0, 40);
  const extra = (Array.isArray(body.cards) ? Math.min(20, body.cards.length) : 0) + (Array.isArray(body.submits) ? Math.min(20, body.submits.length) : 0) + (Array.isArray(body.questions) ? Math.min(40, body.questions.length) : 0) + (Array.isArray(body.flows) ? Math.min(20, body.flows.length) : 0) + (Array.isArray(body.aliasUse) ? Math.min(20, body.aliasUse.length) : 0) + (Array.isArray(body.applications) ? Math.min(20, body.applications.length) : 0) + (Array.isArray(body.proposals) ? Math.min(10, body.proposals.length) : 0) + (Array.isArray(body.unfilled) ? Math.min(20, body.unfilled.length) : 0)
    + (body.intel && typeof body.intel === 'object' ? 1 + Math.min(5, (body.intel.terms || []).length) + Math.min(20, (body.intel.dismissals || []).length) + Math.min(60, (body.intel.snapshot || []).length) : 0);
  const kv = env.WAITLIST, countKey = `controls:${install}:${day(now)}`;
  const count = kv ? Number(await kv.get(countKey)) || 0 : 0;
  if (count + samples.length + outcomes.length + extra > PER_INSTALL_PER_DAY) return Response.json({ok: false, error: 'limit reached for today'}, {status: 429});
  if (kv) await kv.put(countKey, String(count + samples.length + outcomes.length + extra), {expirationTtl: 2 * 86400});
  let storedSamples = 0, storedOutcomes = 0;
  // One row per fill (extension/fill-card.js, checked again here), then what Submit added to it: the learning digest's material.
  for (const raw of (Array.isArray(body.cards) ? body.cards : []).slice(0, 20)) {
    const card = cleanCard(raw), board = text(raw?.board, 40).toLowerCase();
    if (!card || !/^(h:[0-9a-f]{10}|[a-z0-9.-]{2,40})$/.test(board)) continue;
    const added = await env.STATS.prepare(`INSERT OR IGNORE INTO fill_cards (id, day, board, version, required, filled, left_n, unread, optional, optional_filled, causes, kinds, ai, kit, seconds)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(card.id, day(now), board, card.v, card.required, card.filled, card.left, card.unread, card.optional,
      card.optionalFilled, JSON.stringify(card.causes), JSON.stringify(card.kinds), card.ai, card.kit ? 1 : 0, card.seconds).run();
    // The host the application ended on, counted once per card (a resent card adds nothing), under the hashed install: only ever served as an aggregate of >= 3 installs (src/hostuse.js).
    if ((added?.meta?.changes ?? added?.changes ?? 0) > 0 && raw?.host) await recordUse(env.STATS, {install: await hashed(env, install), day: day(now), host: raw.host, ready: card.left === 0 && card.required > 0});
  }
  for (const item of (Array.isArray(body.submits) ? body.submits : []).slice(0, 20)) {
    const id = String(item?.id || ''), n = value => Math.max(0, Math.min(100, Math.round(Number(value)) || 0));
    if (!/^[\w-]{8,40}$/.test(id)) continue;
    await env.STATS.prepare(`UPDATE fill_cards SET submitted = MAX(submitted, ?), by_you = MAX(by_you, ?), by_you_unread = MAX(by_you_unread, ?), page_error = MAX(page_error, ?) WHERE id = ?`)
      .bind(item.submitted ? 1 : 0, n(item.by_you), n(item.by_you_unread), n(item.page_error), id).run();
  }
  const family = Array.isArray(body.exposure) && body.exposure.length ? await familyOfInstall(env.STATS, install) : 'unknown';   // src/engines.js
  for (const item of (Array.isArray(body.exposure) ? body.exposure : []).slice(0, 20)) {
    const board = text(item?.board, 40).toLowerCase();
    const n = Math.max(0, Math.min(1000, Math.round(Number(item?.n)) || 0));
    const required = Math.max(0, Math.min(200 * n, Math.round(Number(item?.required)) || 0));   // required questions on those forms (0: an older app)
    if (!/^(h:[0-9a-f]{10}|[a-z0-9.-]{2,40})$/.test(board) || !n) continue;
    await env.STATS.prepare('INSERT INTO form_exposure (day, board, ai_family, n, required) VALUES (?, ?, ?, ?, ?) ON CONFLICT (day, board, ai_family) DO UPDATE SET n = n + excluded.n, required = required + excluded.required')
      .bind(day(now), board, family, n, required).run();
  }
  for (const item of samples) {
    const fingerprint = String(item?.fingerprint || '');
    const skeleton = cleanSkeleton(item?.skeleton);
    if (!/^[a-z0-9]{6,16}$/.test(fingerprint) || !skeleton) continue;
    const json = JSON.stringify(skeleton);
    if (json.length > MAX_SKELETON) continue;
    const have = (await env.STATS.prepare('SELECT COUNT(*) AS n FROM control_samples WHERE fingerprint = ?').bind(fingerprint).first())?.n || 0;
    if (have >= SAMPLES_PER_FINGERPRINT) continue;
    await env.STATS.prepare('INSERT INTO control_samples (fingerprint, kind, skeleton, question, seen_at) VALUES (?, ?, ?, ?, ?)')
      .bind(fingerprint, text(item.kind, 24), json, text(item.question, 120), now.toISOString()).run();
    storedSamples++;
  }
  for (const item of outcomes) {
    const fingerprint = String(item?.fp || '');
    if (!/^[a-z0-9]{6,16}$/.test(fingerprint)) continue;
    const num = value => Math.max(0, Math.min(1000, Math.round(Number(value)) || 0));
    const ok = num(item.ok), failed = num(item.failed), recipe = Math.min(9999, num(item.recipe));
    if (!ok && !failed) continue;
    await env.STATS.prepare(`INSERT INTO control_outcomes (day, fingerprint, recipe, ok, failed) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (day, fingerprint, recipe) DO UPDATE SET ok = ok + excluded.ok, failed = failed + excluded.failed`)
      .bind(day(now), fingerprint, recipe, ok, failed).run();
    storedOutcomes++;
  }
  await storeIntelligence(env, body.intel, now, install).catch(() => ({}));   // what the installs teach about the job search (src/intelligence.js)
  await storeAliasUse(env, body.aliasUse, now).catch(() => 0);
  await storeAliasProposals(env, body.proposals, install, now).catch(() => ({}));   // what learned notes say a wording means (src/aliases.js)   // how the service's label meanings fared (src/aliases.js)
  const learned = await storeKnowledge(env, body, install, now).catch(() => ({questions: 0, flows: 0, applications: 0}));   // question wording, flow counts and application outcomes (src/knowledge.js)
  return Response.json({ok: true, samples: storedSamples, outcomes: storedOutcomes, ...learned});
}

// ---- GET /api/recipes/targets (owner): what the private recipe proposer should work on ----
// Controls that fail for users and have no recipe being tried (candidate, canary or verified), worst first. Each comes with
// what the proposer needs and nothing else: the scrubbed skeleton samples, the form's question, the failure counts (the form lab, retired 9 Oct 2026, gave reasons too),
// and any earlier recipes (disabled ones) so it does not propose the same thing twice. A control already tried 3 times rests.
const MAX_ATTEMPTS = 3;
export async function targets(request, env, now = new Date(), limit = 20, days = 30) {
  if (!env.STATS) return Response.json({ok: false, error: 'not configured'}, {status: 503});
  if (request.method !== 'GET') return new Response('Method not allowed', {status: 405});
  if (!await isOwner(request, env)) return new Response('Not found', {status: 404});
  const db = env.STATS, from = day(new Date(now.getTime() - (days - 1) * 86400000));
  const asked = Number(new URL(request.url).searchParams.get('limit'));
  const max = Math.max(1, Math.min(50, Number.isFinite(asked) && asked > 0 ? Math.round(asked) : limit));
  const found = new Map();
  const entry = fingerprint => { if (!found.has(fingerprint)) found.set(fingerprint, {fingerprint, userFailed: 0, userAttempts: 0}); return found.get(fingerprint); };
  for (const row of (await db.prepare('SELECT fingerprint, SUM(failed) AS failed, SUM(ok + failed) AS n FROM control_outcomes WHERE day >= ? GROUP BY fingerprint HAVING SUM(failed) > 0').bind(from).all()).results || []) {
    Object.assign(entry(row.fingerprint), {userFailed: row.failed, userAttempts: row.n});
  }
  const out = [];
  const ranked = [...found.values()].sort((a, b) => b.userFailed - a.userFailed);
  for (const item of ranked) {
    if (out.length >= max) break;
    const tried = (await db.prepare('SELECT version, status, note, body FROM recipes WHERE fingerprint = ? ORDER BY version').bind(item.fingerprint).all()).results || [];
    if (tried.some(row => ['candidate', 'canary', 'verified'].includes(row.status)) || tried.length >= MAX_ATTEMPTS) continue;
    const samples = ((await db.prepare('SELECT kind, skeleton, question FROM control_samples WHERE fingerprint = ? ORDER BY seen_at DESC LIMIT 3').bind(item.fingerprint).all()).results || [])
      .map(row => { try { return {kind: row.kind, question: row.question, skeleton: JSON.parse(row.skeleton)}; } catch { return null; } }).filter(Boolean);
    if (!samples.length) continue;   // nothing to show the proposer
    out.push({...item, kind: samples[0].kind, question: samples[0].question, samples: samples.map(sample => sample.skeleton), whys: [],
      version: (tried.length ? Math.max(...tried.map(row => row.version)) : 0) + 1,
      previous: tried.map(row => ({version: row.version, status: row.status, note: row.note, recipe: (() => { try { return JSON.parse(row.body); } catch { return null; } })()}))});
  }
  return Response.json({generated: now.toISOString(), targets: out}, {headers: {'Cache-Control': 'private, no-store'}});
}

// ---- the canary, judged daily ----
// A recipe that works is given more installs (5% → 25% → 100%, verified at the end); one that fails is stopped. Only its own
// attempts since it last changed count. Returns what it did, for the log.
export async function evaluateCanary(db, now = new Date()) {
  const actions = [];
  // A candidate starts at the first step by itself (owner, 9 Oct 2026: the form lab that tried candidates first was retired). It must still
  // pass the shape check; the judging below then grows or halts it on real use. A candidate whose fingerprint already runs a recipe waits.
  for (const candidate of (await db.prepare("SELECT fingerprint, version, body FROM recipes WHERE status = 'candidate'").all()).results || []) {
    const busy = await db.prepare("SELECT 1 AS n FROM recipes WHERE fingerprint = ? AND status IN ('canary', 'verified')").bind(candidate.fingerprint).first();
    let checked = {ok: false};
    try { checked = validateRecipe(JSON.parse(candidate.body)); } catch { /* not JSON: stays a candidate */ }
    if (busy || !checked.ok) continue;
    await db.prepare("UPDATE recipes SET status = 'canary', rollout = ?, note = ?, updated_at = ? WHERE fingerprint = ? AND version = ?")
      .bind(STEPS[0], 'auto: candidate started', now.toISOString(), candidate.fingerprint, candidate.version).run();
    actions.push({recipe: `${candidate.fingerprint} v${candidate.version}`, action: `started at ${STEPS[0]}%`});
  }
  const running = (await db.prepare("SELECT fingerprint, version, rollout, updated_at FROM recipes WHERE status = 'canary'").all()).results || [];
  for (const recipe of running) {
    const since = recipe.updated_at.slice(0, 10);
    const sums = await db.prepare('SELECT SUM(ok) AS ok, SUM(failed) AS failed FROM control_outcomes WHERE fingerprint = ? AND recipe = ? AND day >= ?')
      .bind(recipe.fingerprint, recipe.version, since).first();
    const ok = sums?.ok || 0, failed = sums?.failed || 0, attempts = ok + failed;
    const rate = attempts ? failed / attempts : 0;
    const label = `${recipe.fingerprint} v${recipe.version}`;
    if (attempts >= MIN_FAIL_CHECK && rate > HALT_ABOVE) {
      await db.prepare("UPDATE recipes SET status = 'disabled', rollout = 0, note = ?, updated_at = ? WHERE fingerprint = ? AND version = ?")
        .bind(`auto-halted: ${failed} of ${attempts} failed`, now.toISOString(), recipe.fingerprint, recipe.version).run();
      actions.push({recipe: label, action: 'halted', attempts, rate});
    } else if (attempts >= MIN_PROMOTE && rate <= PROMOTE_BELOW) {
      const next = STEPS.find(step => step > recipe.rollout) || 100;
      await db.prepare('UPDATE recipes SET status = ?, rollout = ?, note = ?, updated_at = ? WHERE fingerprint = ? AND version = ?')
        .bind(next >= 100 ? 'verified' : 'canary', next, `auto: ${failed} of ${attempts} failed`, now.toISOString(), recipe.fingerprint, recipe.version).run();
      actions.push({recipe: label, action: next >= 100 ? 'verified' : `grown to ${next}%`, attempts, rate});
    }
  }
  return actions;
}

// A verified recipe keeps being judged over the last week of real use: if its failure rate climbs past the halt line it is switched off
// (the operators' built-in behaviour takes over) and the proposer is free to try again.
export async function evaluateVerified(db, now = new Date()) {
  const from = day(new Date(now.getTime() - 6 * 86400000));
  const actions = [];
  for (const recipe of (await db.prepare("SELECT fingerprint, version FROM recipes WHERE status = 'verified'").all()).results || []) {
    const sums = await db.prepare('SELECT SUM(ok) AS ok, SUM(failed) AS failed FROM control_outcomes WHERE fingerprint = ? AND recipe = ? AND day >= ?').bind(recipe.fingerprint, recipe.version, from).first();
    const ok = sums?.ok || 0, failed = sums?.failed || 0, attempts = ok + failed, rate = attempts ? failed / attempts : 0;
    if (attempts >= MIN_FAIL_CHECK && rate > HALT_ABOVE) {
      await db.prepare("UPDATE recipes SET status = 'disabled', rollout = 0, note = ?, updated_at = ? WHERE fingerprint = ? AND version = ?")
        .bind(`auto-rolled back: ${failed} of ${attempts} failed in a week`, now.toISOString(), recipe.fingerprint, recipe.version).run();
      actions.push({recipe: `${recipe.fingerprint} v${recipe.version}`, action: 'rolled back', attempts, rate});
    }
  }
  return actions;
}

// The owner's view: the controls that fail most, with what is being done about them.
export async function controlStats(db, days = 7, now = new Date()) {
  const from = day(new Date(now.getTime() - (days - 1) * 86400000));
  const rows = (await db.prepare(`SELECT o.fingerprint, SUM(o.ok) AS ok, SUM(o.failed) AS failed,
      (SELECT kind FROM control_samples s WHERE s.fingerprint = o.fingerprint LIMIT 1) AS kind,
      (SELECT question FROM control_samples s WHERE s.fingerprint = o.fingerprint LIMIT 1) AS question,
      (SELECT status || ' v' || version || ' (' || rollout || '%)' FROM recipes r WHERE r.fingerprint = o.fingerprint ORDER BY version DESC LIMIT 1) AS recipe
    FROM control_outcomes o WHERE o.day >= ? GROUP BY o.fingerprint ORDER BY failed DESC, ok DESC LIMIT 30`).bind(from).all()).results || [];
  return rows;
}
