// The facts forms ask most, learned from installs (owner, 18 Oct 2026: the missing-facts order is "blocked fills > server counts > section order"). An install reports
// which facts of Your details its forms asked, as FIXED ids (desktop/lib/missing-facts.js CATALOG: no wording, no text); a fact is served once 3+ installs reported it
// in the last 30 days, as {fact, share} = the share of the reporting installs that were asked it. Rides POST /api/controls (intel.facts) and GET /api/packs/aliases (facts).
// The app turns the share into an order; the server never sends text. Guarded by test/fact-asks.test.js.
import {CATALOG} from '../../desktop/lib/fact-catalog.js';
import {digestOf} from './guard.js';

export const FACTS = CATALOG.map(fact => fact.id);
export const MIN_INSTALLS = 3, WINDOW_DAYS = 30;
const day = date => date.toISOString().slice(0, 10);

// -> how many fact ids were kept.
export async function store(db, facts, install, now = new Date()) {
  const ids = [...new Set((Array.isArray(facts) ? facts : []).map(String).filter(id => FACTS.includes(id)))];
  if (!db || !ids.length) return 0;
  const who = (await digestOf(String(install || 'anonymous'))).slice(0, 12);
  for (const id of ids) await db.prepare('INSERT INTO intel_facts (fact, install, last_day) VALUES (?, ?, ?) ON CONFLICT (fact, install) DO UPDATE SET last_day = excluded.last_day').bind(id, who, day(now)).run();
  return ids.length;
}

// -> [{fact, share}], the most asked first; a fact fewer than MIN_INSTALLS installs reported is left out.
export async function shares(db, now = new Date()) {
  const from = day(new Date(now.getTime() - (WINDOW_DAYS - 1) * 86400000));
  const found = (await db.prepare('SELECT fact, COUNT(*) AS n FROM intel_facts WHERE last_day >= ? GROUP BY fact').bind(from).all()).results || [];
  const people = (await db.prepare('SELECT COUNT(DISTINCT install) AS n FROM intel_facts WHERE last_day >= ?').bind(from).first())?.n || 0;
  return found.filter(row => FACTS.includes(row.fact) && row.n >= MIN_INSTALLS && people).sort((a, b) => b.n - a.n)
    .map(row => ({fact: row.fact, share: Math.round(row.n / people * 100) / 100}));
}

// Daily: a report older than the window is dropped.
export async function tidy(db, now = new Date()) {
  const cutoff = day(new Date(now.getTime() - WINDOW_DAYS * 86400000));
  await db.prepare('DELETE FROM intel_facts WHERE last_day < ?').bind(cutoff).run();
}
