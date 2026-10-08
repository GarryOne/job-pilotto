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
