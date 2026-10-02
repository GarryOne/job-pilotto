// The shared recipe library for the self-improving form filler (Notion: "Self-improving form filling: design & plan").
//   GET  /api/recipes   public, cacheable: recipes that are running (canary or verified) with the share of installs that use them.
//                       Every app downloads it at most daily (desktop/lib/recipes.js), like the employer index.
//   PUT  /api/recipes   the owner's key (same as /stats): the form lab or the owner adds a recipe, or changes its status.
//   POST /api/controls  from apps: scrubbed control structures (to propose recipes from) and how the operators fared (the canary's
//                       evidence). Product data only: no user data, no text, no answers.
// evaluateCanary (daily) promotes a canary that works and halts one that fails, with no one watching.
import {validateRecipe} from '../../extension/recipe-schema.js';
import {allowed} from './stats.js';

const STATUSES = ['candidate', 'canary', 'verified', 'disabled'];
const STEPS = [5, 25, 100];                  // a canary's rollout, in order
const MIN_FAIL_CHECK = 20, HALT_ABOVE = 0.25;   // enough attempts to judge, and the failure rate that stops a recipe
const MIN_PROMOTE = 50, PROMOTE_BELOW = 0.05;   // enough attempts to trust it, and the failure rate that lets it grow
const SAMPLES_PER_FINGERPRINT = 3, MAX_SKELETON = 6000, PER_INSTALL_PER_DAY = 500;
const day = date => date.toISOString().slice(0, 10);
const text = (value, max) => String(value ?? '').replace(/[\u0000-\u001f<>`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

async function digest(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return [...bytes.slice(0, 8)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---- GET / PUT /api/recipes ----
export async function recipes(request, env, now = new Date()) {
  if (!env.STATS) return Response.json({ok: false, error: 'not configured'}, {status: 503});
  if (request.method === 'GET') {
    const rows = (await env.STATS.prepare(`SELECT fingerprint, version, status, rollout, body FROM recipes WHERE status IN ('canary', 'verified')
      ORDER BY fingerprint, version DESC`).all()).results || [];
    const seen = new Set(), out = [];
    for (const row of rows) {
      if (seen.has(row.fingerprint)) continue;   // the newest running version only
      seen.add(row.fingerprint);
      const checked = validateRecipe(JSON.parse(row.body));
      if (checked.ok) out.push({...checked.recipe, rollout: row.status === 'verified' ? 100 : row.rollout});
    }
    const body = JSON.stringify({recipes: out});
    const tag = `"${await digest(body)}"`;
    const headers = {'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600', ETag: tag};
    if (request.headers.get('If-None-Match') === tag) return new Response(null, {status: 304, headers});
    return new Response(JSON.stringify({generated: now.toISOString(), recipes: out}), {headers});
  }
  if (request.method !== 'PUT') return new Response('Method not allowed', {status: 405});
  if (!allowed(request, env)) return new Response('Not found', {status: 404});
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
  const kv = env.WAITLIST, countKey = `controls:${install}:${day(now)}`;
  const count = kv ? Number(await kv.get(countKey)) || 0 : 0;
  if (count + samples.length + outcomes.length > PER_INSTALL_PER_DAY) return Response.json({ok: false, error: 'limit reached for today'}, {status: 429});
  if (kv) await kv.put(countKey, String(count + samples.length + outcomes.length), {expirationTtl: 2 * 86400});
  let storedSamples = 0, storedOutcomes = 0;
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
  return Response.json({ok: true, samples: storedSamples, outcomes: storedOutcomes});
}

// ---- the canary, judged daily ----
// A recipe that works is given more installs (5% → 25% → 100%, verified at the end); one that fails is stopped. Only its own
// attempts since it last changed count. Returns what it did, for the log.
export async function evaluateCanary(db, now = new Date()) {
  const running = (await db.prepare("SELECT fingerprint, version, rollout, updated_at FROM recipes WHERE status = 'canary'").all()).results || [];
  const actions = [];
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
