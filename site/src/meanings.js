// The meanings pack (owner, 8 Oct 2026): wording -> fixed answer per topic, served in GET /api/packs/aliases beside the label meanings.
// The seed (the keyword lists the code used before; site/migrations/0039_meanings_seed.sql, tools/meanings_seed.py) also ships with the
// app as its offline floor, so the pack sends only what the app lacks: learned rows running for this install, and seed rows switched off
// here ('off'), which the app then leaves out. Topics and answers: config/meanings_schema.json, checked here and again in the engine.
import SCHEMA from '../../config/meanings_schema.json' with {type: 'json'};
import {appliesTo} from '../../extension/recipe-schema.js';

const TOPICS = Object.fromEntries(Object.entries(SCHEMA).filter(([topic]) => !topic.startsWith('_')));
export const validRow = row => Boolean(TOPICS[row?.topic]?.answers.includes(row.answer)) && ['pattern', 'exact'].includes(row.kind)
  && typeof row.wording === 'string' && row.wording.trim() && row.wording.length <= (row.kind === 'exact' ? 200 : 2000);

export async function packMeanings(db, install) {
  const rows = (await db.prepare("SELECT topic, kind, wording, answer, ord, status, rollout, source FROM meanings WHERE source NOT LIKE 'seed:%' AND status IN ('canary', 'verified')").all()).results || [];
  const off = (await db.prepare("SELECT topic, kind, wording FROM meanings WHERE source LIKE 'seed:%' AND status = 'disabled'").all()).results || [];
  return {
    rows: rows.filter(validRow).filter(row => appliesTo({rollout: row.status === 'verified' ? 100 : row.rollout}, install))
      .map(({topic, kind, wording, answer, ord}) => ({topic, kind, wording, answer, ord})),
    off: off.map(row => [row.topic, row.kind, row.wording]),
  };
}

// Learning: an install's AI answers for public wordings (topics with share: true; never a user's own words or mail) arrive as votes, one
// per install and wording. Daily, a wording that 3+ installs answered alike (2/3 of its votes or more) becomes a 5% canary row, grows to
// 25% and 100% every 3 days while the votes still agree, and is switched off when they stop agreeing. The owner's kill switch: status.
export const MIN_INSTALLS = 3, MIN_SHARE = 2 / 3, STEPS = [5, 25, 100], GROW_DAYS = 3, MAX_VOTES = 200;
const SHARED = new Set(Object.entries(TOPICS).filter(([, spec]) => spec.share).map(([topic]) => topic));
const plain = text => String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();

export async function vote(db, install, rows, now = new Date()) {
  let kept = 0;
  for (const row of (Array.isArray(rows) ? rows : []).slice(0, MAX_VOTES)) {
    const item = {topic: row?.topic, kind: 'exact', wording: plain(row?.wording), answer: row?.answer};
    if (!SHARED.has(item.topic) || !validRow(item)) continue;
    await db.prepare('INSERT OR REPLACE INTO meaning_votes (topic, wording, answer, install, at) VALUES (?, ?, ?, ?, ?)')
      .bind(item.topic, item.wording, item.answer, install, now.toISOString()).run();
    kept++;
  }
  return kept;
}

export async function evaluateMeanings(db, now = new Date()) {
  const actions = [], stamp = now.toISOString();
  const tallies = (await db.prepare('SELECT topic, wording, answer, COUNT(*) AS n FROM meaning_votes GROUP BY topic, wording, answer').all()).results || [];
  const totals = {};
  for (const t of tallies) totals[`${t.topic}\u0000${t.wording}`] = (totals[`${t.topic}\u0000${t.wording}`] || 0) + t.n;
  const agreed = t => t.n >= MIN_INSTALLS && t.n / totals[`${t.topic}\u0000${t.wording}`] >= MIN_SHARE;
  const rows = (await db.prepare("SELECT topic, wording, answer, status, rollout, updated_at FROM meanings WHERE kind = 'exact' AND source = 'learned'").all()).results || [];
  const known = Object.fromEntries(rows.map(r => [`${r.topic}\u0000${r.wording}`, r]));
  for (const t of tallies.filter(agreed)) {
    if (known[`${t.topic}\u0000${t.wording}`] || !SHARED.has(t.topic)) continue;
    await db.prepare("INSERT INTO meanings (topic, kind, wording, answer, ord, status, rollout, source, updated_at) VALUES (?, 'exact', ?, ?, 0, 'canary', ?, 'learned', ?)")
      .bind(t.topic, t.wording, t.answer, STEPS[0], stamp).run();
    actions.push({meaning: `${t.topic}: ${t.wording}`, action: 'canary', installs: t.n});
  }
  for (const row of rows.filter(r => ['canary', 'verified'].includes(r.status))) {
    const still = tallies.some(t => t.topic === row.topic && t.wording === row.wording && t.answer === row.answer && agreed(t));
    if (!still) {
      await db.prepare("UPDATE meanings SET status = 'disabled', rollout = 0, updated_at = ? WHERE topic = ? AND kind = 'exact' AND wording = ?").bind(stamp, row.topic, row.wording).run();
      actions.push({meaning: `${row.topic}: ${row.wording}`, action: 'switched off: installs no longer agree'});
    } else if (row.status === 'canary' && now - new Date(row.updated_at) >= GROW_DAYS * 86400000) {
      const next = STEPS[STEPS.indexOf(row.rollout) + 1];
      await db.prepare('UPDATE meanings SET status = ?, rollout = ?, updated_at = ? WHERE topic = ? AND kind = ? AND wording = ?')
        .bind(next ? 'canary' : 'verified', next || 100, stamp, row.topic, 'exact', row.wording).run();
      actions.push({meaning: `${row.topic}: ${row.wording}`, action: next ? `canary ${next}%` : 'verified'});
    }
  }
  return actions;
}
