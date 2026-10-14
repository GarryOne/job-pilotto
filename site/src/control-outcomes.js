// Operator outcomes per control fingerprint and where they came from (control_outcomes, migration 0070): stored from /api/controls, read by the canary, the digest and the proposer's target list.
// 'user' = a real install; 'pool' (the owner's smoke pool) and 'replay' (offline replays) are lab data, sent with the owner's key. Promotion, halting and the digest count 'user' only;
// the target list ranks user failures first and lab failures second, so the proposer works from real misses and falls back to lab ones while installs are few.
// why = the latest fixed reason word of a failed attempt (extension/recipe-schema.js CONTROL_WHYS), never text. Guarded by site/test/control-outcomes.test.js.
import {CONTROL_WHYS} from '../../extension/recipe-schema.js';

export const SOURCES = ['user', 'pool', 'replay'];
const num = value => Math.max(0, Math.min(1000, Math.round(Number(value)) || 0));

// items [{fp, recipe, ok, failed, why}] -> how many rows were stored.
export async function storeOutcomes(db, items, {source = 'user', day, limit = 40} = {}) {
  let stored = 0;
  if (!SOURCES.includes(source)) return 0;
  for (const item of (Array.isArray(items) ? items : []).slice(0, limit)) {
    const fingerprint = String(item?.fp || '');
    if (!/^[a-z0-9]{6,16}$/.test(fingerprint)) continue;
    const ok = num(item.ok), failed = num(item.failed), recipe = Math.min(9999, num(item.recipe));
    if (!ok && !failed) continue;
    const why = failed && CONTROL_WHYS.includes(item.why) ? item.why : '';
    await db.prepare(`INSERT INTO control_outcomes (day, fingerprint, recipe, source, ok, failed, why) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (day, fingerprint, recipe, source) DO UPDATE SET ok = ok + excluded.ok, failed = failed + excluded.failed, why = CASE WHEN excluded.why != '' THEN excluded.why ELSE why END`)
      .bind(day, fingerprint, recipe, source, ok, failed, why).run();
    stored++;
  }
  return stored;
}

// Failure counts per fingerprint since `from`: {fingerprint -> {userFailed, userAttempts, labFailed, labAttempts, whys: [word]}}.
export async function failuresSince(db, from) {
  const found = new Map();
  const entry = fingerprint => { if (!found.has(fingerprint)) found.set(fingerprint, {fingerprint, userFailed: 0, userAttempts: 0, labFailed: 0, labAttempts: 0, whys: []}); return found.get(fingerprint); };
  for (const row of (await db.prepare('SELECT fingerprint, source, SUM(failed) AS failed, SUM(ok + failed) AS n FROM control_outcomes WHERE day >= ? GROUP BY fingerprint, source HAVING SUM(failed) > 0').bind(from).all()).results || []) {
    const item = entry(row.fingerprint);
    if (row.source === 'user') Object.assign(item, {userFailed: row.failed, userAttempts: row.n}); else { item.labFailed += row.failed; item.labAttempts += row.n; }
  }
  for (const row of (await db.prepare("SELECT fingerprint, why FROM control_outcomes WHERE day >= ? AND failed > 0 AND why != '' GROUP BY fingerprint, why ORDER BY MAX(day) DESC").bind(from).all()).results || []) {
    const item = found.get(row.fingerprint);
    if (item && !item.whys.includes(row.why)) item.whys.push(row.why);
  }
  return found;
}
