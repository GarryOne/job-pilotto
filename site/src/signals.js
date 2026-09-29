// GET /api/signals?days=7 (the /stats key, as `Authorization: Bearer`): the numbers the daily product brief reads
// (.github/workflows/product-brain.yml): website visits and downloads, app problems and outcome totals, how many
// joined the Pro waitlist, and users' feedback (their words, never their contact). No emails, visitor hashes or samples.
import {allowed, report, signups} from './stats.js';
import {problems} from './telemetry.js';
import {recentFeedback} from './feedback.js';

// License ids seen in apps' daily health lines (30 days): the last day and version per id. Only random ids: the
// owner maps them to people in his private Notion (tools/license.py sync, private ops repo).
export async function licensesSeen(db, now = new Date()) {
  const from = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);
  const rows = (await db.prepare("SELECT at, version, data FROM telemetry WHERE kind = 'health' AND day >= ? ORDER BY at")
    .bind(from).all()).results || [];
  const seen = {};
  for (const row of rows) {
    let data = {};
    try { data = JSON.parse(row.data); } catch {}
    if (typeof data.licenseId === 'string' && /^[0-9a-f]{8}$/.test(data.licenseId)) seen[data.licenseId] = {lastSeen: row.at, version: row.version};
  }
  return seen;
}

export async function signals(request, env, now = new Date()) {
  if (!allowed(request, env) || !env.STATS) return new Response('Not found', {status: 404});
  const asked = Number(new URL(request.url).searchParams.get('days'));
  const days = [1, 7, 30].includes(asked) ? asked : 7;
  const [site, app, waitlist, said] = await Promise.all([report(env.STATS, days, now), problems(env.STATS, days, now, 20), signups(env.WAITLIST),
    recentFeedback(env.STATS, 30, now).catch(() => [])]);
  const licenses = await licensesSeen(env.STATS, now).catch(() => ({}));  // feedback: the users' own words (no contact details)
  const since = new Date(now.getTime() - days * 86400000).toISOString();
  const strip = ({sample, ...rest}) => rest;  // eslint-disable-line no-unused-vars
  return Response.json({ok: true, days, website: site, app: {...app, rows: (app.rows || []).map(strip)},
    waitlist: {total: waitlist.length, recent: waitlist.filter(entry => entry.at >= since).length},
    feedback: said.map(({at, version, text}) => ({at, version, text})), licenses},
  {headers: {'Cache-Control': 'no-store'}});
}
