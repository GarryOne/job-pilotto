// Label meanings served to installs (format extension/alias-schema.js; plan in Notion "Knowledge as data: build plan").
//   GET  /api/packs/aliases   an install with a token: the aliases running for it (canary share by install bucket, then everyone).
//   GET  /api/aliases         the owner: all of them (?status=candidate), the questions still without a meaning (?targets=1) and the button
//                             texts of pages where no Apply button was recognised (?targets=buttons).
//   PUT  /api/aliases         the owner (the private proposer): add or change aliases, or record {reviewed: [{label}]} wordings that mean nothing. Sensitive fields (birth date, address ...)
//                             only go live when the owner passes approved: true.
// evaluateAliases (daily) grows a canary that works and halts one that fails, like the recipes' canary; sensitive ones are only ever halted.
import {hints} from './intelligence.js';
import {BUTTON_KEYS, KEYS, SENSITIVE, aliasKey, cleanLabel, validateAlias} from '../../extension/alias-schema.js';
import {appliesTo} from '../../extension/recipe-schema.js';
import {authorize, flag} from './guard.js';
import {report} from './knowledge.js';
import {allowed} from './stats.js';

const STATUSES = ['candidate', 'canary', 'verified', 'disabled'];
const STEPS = [5, 25, 100];
const REVIEW_DAYS = 30;
const PER_INSTALL_PER_DAY = 24, MIN_FAIL_CHECK = 20, HALT_ABOVE = 0.25, MIN_PROMOTE = 50, PROMOTE_BELOW = 0.05;
const day = date => date.toISOString().slice(0, 10);
const json = (body, status = 200) => Response.json(body, {status, headers: {'Cache-Control': 'private, no-store'}});

// GET /api/packs/aliases
export async function pack(request, env, now = new Date()) {
  if (request.method !== 'GET') return new Response('Method not allowed', {status: 405});
  if (!env.STATS) return json({ok: false, error: 'not configured'}, 503);
  const install = request.headers.get('X-Install-Id') || '';
  const access = await authorize(env, install, (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, ''), 'recipes');
  if (!access.ok) return json({ok: false, error: 'unauthorized'}, 401);
  if (env.WAITLIST) {
    const key = `aliases-get:${install}:${day(now)}`;
    const used = Number(await env.WAITLIST.get(key)) || 0;
    if (used >= PER_INSTALL_PER_DAY) { await flag(env, 'quota', access.who, 'aliases', now); return json({ok: false, error: 'limit reached for today'}, 429); }
    await env.WAITLIST.put(key, String(used + 1), {expirationTtl: 2 * 86400});
  }
  const rows = (await env.STATS.prepare("SELECT key, phrase, status, rollout FROM aliases WHERE status IN ('canary', 'verified')").all()).results || [];
  const out = [];
  for (const row of rows) {
    const checked = validateAlias(row);
    const rollout = row.status === 'verified' ? 100 : row.rollout;
    if (checked.ok && appliesTo({rollout}, install)) out.push({...checked.alias, rollout});
  }
  return json({ok: true, aliases: out, hints: await hints(env.STATS, now).catch(() => [])});
}

// Daily: a verified alias keeps being judged over the last week; if it starts failing it is switched off like a canary would be.
export async function evaluateVerifiedAliases(db, now = new Date()) {
  const from = day(new Date(now.getTime() - 6 * 86400000));
  const actions = [];
  for (const item of (await db.prepare("SELECT phrase FROM aliases WHERE status = 'verified'").all()).results || []) {
    const sums = await db.prepare('SELECT SUM(ok) AS ok, SUM(failed) AS failed FROM alias_outcomes WHERE phrase = ? AND day >= ?').bind(item.phrase, from).first();
    const ok = sums?.ok || 0, failed = sums?.failed || 0, attempts = ok + failed, rate = attempts ? failed / attempts : 0;
    if (attempts >= MIN_FAIL_CHECK && rate > HALT_ABOVE) {
      await db.prepare("UPDATE aliases SET status = 'disabled', rollout = 0, note = ?, updated_at = ? WHERE phrase = ?").bind(`auto-rolled back: ${failed} of ${attempts} failed in a week`, now.toISOString(), item.phrase).run();
      actions.push({alias: item.phrase, action: 'rolled back', attempts, rate});
    }
  }
  return actions;
}

// GET / PUT /api/aliases (owner)
export async function aliases(request, env, now = new Date()) {
  if (!env.STATS) return json({ok: false, error: 'not configured'}, 503);
  if (!allowed(request, env)) return new Response('Not found', {status: 404});
  const url = new URL(request.url);
  if (request.method === 'GET') {
    const all = (await env.STATS.prepare('SELECT key, phrase, status, rollout, source, note FROM aliases ORDER BY phrase').all()).results || [];
    const mode = url.searchParams.get('targets');
    if (mode === 'fixes') {
      // Questions the filler answers that people then change by hand (3+ installs, 10+ fills, 30%+ changed): the mapping or the profile field may be wrong.
      const known = all.map(row => ({key: row.key, phrase: row.phrase}));
      const since = day(new Date(now.getTime() - REVIEW_DAYS * 86400000));
      const reviewed = new Set(((await env.STATS.prepare('SELECT label FROM label_reviews WHERE day >= ?').bind(since).all().catch(() => ({results: []}))).results || []).map(row => row.label));
      const found = ((await env.STATS.prepare('SELECT label, filled, corrected, installs FROM intel_fixes WHERE filled >= 10 AND CAST(corrected AS REAL) / filled >= 0.3 ORDER BY corrected DESC LIMIT 50').all().catch(() => ({results: []}))).results || [])
        .filter(row => { try { return JSON.parse(row.installs).length >= 3; } catch { return false; } }).filter(row => !reviewed.has(row.label))
        .map(row => ({label: row.label, n: row.filled, kind: 'fix', corrected: row.corrected, current: aliasKey(row.label, known) || ''}));
      return json({ok: true, targets: found, keys: KEYS, sensitive: SENSITIVE});
    }
    if (mode === '1' || mode === 'buttons') {
      // Wordings several installs report that no alias places yet and that were not looked at lately: questions, or button texts of pages where no Apply button was found.
      const known = all.map(row => ({key: row.key, phrase: row.phrase}));
      const since = day(new Date(now.getTime() - REVIEW_DAYS * 86400000));
      const reviewed = new Set(((await env.STATS.prepare('SELECT label FROM label_reviews WHERE day >= ?').bind(since).all().catch(() => ({results: []}))).results || []).map(row => row.label));
      const wanted = mode === 'buttons';
      const rows = (await report(env.STATS, 30, now, 400)).questions.filter(row => (row.kind === 'button') === wanted && !reviewed.has(row.label)
        && (wanted ? !known.some(item => item.key === 'apply_button' && item.phrase === row.label) : !aliasKey(row.label, known)));
      return json({ok: true, targets: rows.slice(0, 50), keys: wanted ? BUTTON_KEYS : KEYS, sensitive: SENSITIVE});
    }
    const wanted = url.searchParams.get('status');
    return json({ok: true, aliases: STATUSES.includes(wanted) ? all.filter(row => row.status === wanted) : all});
  }
  if (request.method !== 'PUT') return new Response('Method not allowed', {status: 405});
  const body = await request.json().catch(() => ({}));
  const status = STATUSES.includes(body.status) ? body.status : 'candidate';
  const rollout = status === 'verified' ? 100 : status === 'canary' ? Math.max(1, Math.min(100, Math.round(Number(body.rollout)) || STEPS[0])) : 0;
  for (const item of (Array.isArray(body.reviewed) ? body.reviewed : []).slice(0, 100)) {
    const label = cleanLabel(item?.label);
    if (label) await env.STATS.prepare('INSERT OR REPLACE INTO label_reviews (label, verdict, day) VALUES (?, ?, ?)').bind(label, 'none', day(now)).run();
  }
  const stored = [], refused = [];
  for (const item of (Array.isArray(body.items) ? body.items : []).slice(0, 100)) {
    const checked = validateAlias(item);
    if (!checked.ok) { refused.push(checked.error); continue; }
    if (SENSITIVE.includes(checked.alias.key) && ['canary', 'verified'].includes(status) && body.approved !== true) { refused.push('sensitive field needs approved: true'); continue; }
    await env.STATS.prepare(`INSERT INTO aliases (phrase, key, status, rollout, source, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (phrase) DO UPDATE SET key = excluded.key, status = excluded.status, rollout = excluded.rollout, note = excluded.note, updated_at = excluded.updated_at`)
      .bind(checked.alias.phrase, checked.alias.key, status, rollout, String(body.source || 'owner').slice(0, 20), String(body.note || '').slice(0, 200), now.toISOString(), now.toISOString()).run();
    stored.push(checked.alias.phrase);
  }
  return json({ok: true, status, rollout, stored: stored.length, refused});
}

// From POST /api/controls: how often each alias placed a question and the field took the value.
export async function storeUse(env, items, now = new Date()) {
  let stored = 0;
  for (const item of (Array.isArray(items) ? items : []).slice(0, 20)) {
    const phrase = String(item?.phrase || '');
    const num = value => Math.max(0, Math.min(1000, Math.round(Number(value)) || 0));
    const ok = num(item?.ok), failed = num(item?.failed);
    if (!/^[\p{L}\p{M} '’/&()-]{3,60}$/u.test(phrase) || (!ok && !failed)) continue;
    await env.STATS.prepare(`INSERT INTO alias_outcomes (day, phrase, ok, failed) VALUES (?, ?, ?, ?)
      ON CONFLICT (day, phrase) DO UPDATE SET ok = ok + excluded.ok, failed = failed + excluded.failed`).bind(day(now), phrase, ok, failed).run();
    stored++;
  }
  return stored;
}

// Daily: a canary alias that works is given more installs (verified at the end), one that fails is stopped. Sensitive ones are only stopped.
export async function evaluateAliases(db, now = new Date()) {
  const running = (await db.prepare("SELECT phrase, key, rollout, updated_at FROM aliases WHERE status = 'canary'").all()).results || [];
  const actions = [];
  for (const item of running) {
    const sums = await db.prepare('SELECT SUM(ok) AS ok, SUM(failed) AS failed FROM alias_outcomes WHERE phrase = ? AND day >= ?').bind(item.phrase, item.updated_at.slice(0, 10)).first();
    const ok = sums?.ok || 0, failed = sums?.failed || 0, attempts = ok + failed, rate = attempts ? failed / attempts : 0;
    if (attempts >= MIN_FAIL_CHECK && rate > HALT_ABOVE) {
      await db.prepare("UPDATE aliases SET status = 'disabled', rollout = 0, note = ?, updated_at = ? WHERE phrase = ?").bind(`auto-halted: ${failed} of ${attempts} failed`, now.toISOString(), item.phrase).run();
      actions.push({alias: item.phrase, action: 'halted', attempts, rate});
    } else if (attempts >= MIN_PROMOTE && rate <= PROMOTE_BELOW && !SENSITIVE.includes(item.key)) {
      const next = STEPS.find(step => step > item.rollout) || 100;
      await db.prepare('UPDATE aliases SET status = ?, rollout = ?, note = ?, updated_at = ? WHERE phrase = ?')
        .bind(next >= 100 ? 'verified' : 'canary', next, `auto: ${failed} of ${attempts} failed`, now.toISOString(), item.phrase).run();
      actions.push({alias: item.phrase, action: next >= 100 ? 'verified' : `grown to ${next}%`, attempts, rate});
    }
  }
  return actions;
}
