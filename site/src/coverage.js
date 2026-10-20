// GET /api/coverage: the website's public numbers (owner, 20 Oct 2026), from the central list's latest daily snapshot (index_daily, written at
// each publish by src/employers.js). Counts only: employers, open jobs in Europe, per country, per kind of work, the week's growth; never an
// employer or anything from an install. Read by site/public/coverage.html. Tests: site/test/coverage.test.js.
import {countryName, history, kindName} from './scoutingvisual.js';

const HIDDEN = ['other', 'unknown'];   // shown as one line (other) or not at all (not counted yet): a chart of named kinds only

export async function coverage(env) {
  const none = () => new Response(JSON.stringify({ok: false}), {status: 404, headers: {'Content-Type': 'application/json'}});
  if (!env.STATS) return none();
  const daily = (await env.STATS.prepare('SELECT day, feeds, cells FROM index_daily ORDER BY day DESC LIMIT 14').all().catch(() => ({results: []}))).results || [];
  const latest = history(daily).withCells.at(-1);
  if (!latest) return none();
  const past = history(daily, new Date(`${latest.day}T12:00:00Z`));   // the week before the snapshot, not before today
  const countries = {}, kinds = {};
  let jobs = 0;
  for (const [cell, [count, open]] of Object.entries(latest.cells)) {
    const [kind, country] = cell.split('|');
    countries[country] = (countries[country] || 0) + count;
    kinds[kind] = (kinds[kind] || 0) + count;
    jobs += open;
  }
  const order = rows => rows.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const body = {day: latest.day, employers: latest.feeds, jobs_europe: jobs, country_count: Object.keys(countries).length};
  if (past.week) body.week_added = latest.feeds - past.week.feeds;
  body.countries = order(Object.entries(countries).map(([code, count]) => [countryName(code), count]));
  body.kinds = order(Object.entries(kinds).filter(([kind]) => !HIDDEN.includes(kind)).map(([kind, count]) => [kindName(kind), count]));
  body.other_kinds = kinds.other || 0;
  return new Response(JSON.stringify(body), {headers: {'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600'}});
}
