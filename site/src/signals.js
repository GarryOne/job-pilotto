// GET /api/signals?days=7 (the /stats key, as `Authorization: Bearer`): the numbers the daily product brief reads
// (.github/workflows/product-brain.yml): website visits and downloads, app problems and outcome totals, how many
// joined the Pro waitlist, and users' feedback (their words, never their contact). No emails, visitor hashes or samples.
import {allowed, report, signups} from './stats.js';
import {problems} from './telemetry.js';
import {recentFeedback} from './feedback.js';

export async function signals(request, env, now = new Date()) {
  if (!allowed(request, env) || !env.STATS) return new Response('Not found', {status: 404});
  const asked = Number(new URL(request.url).searchParams.get('days'));
  const days = [1, 7, 30].includes(asked) ? asked : 7;
  const [site, app, waitlist, said] = await Promise.all([report(env.STATS, days, now), problems(env.STATS, days, now, 20), signups(env.WAITLIST),
    recentFeedback(env.STATS, 30, now).catch(() => [])]);  // feedback: the users' own words (no contact details)
  const since = new Date(now.getTime() - days * 86400000).toISOString();
  const strip = ({sample, ...rest}) => rest;  // eslint-disable-line no-unused-vars
  return Response.json({ok: true, days, website: site, app: {...app, rows: (app.rows || []).map(strip)},
    waitlist: {total: waitlist.length, recent: waitlist.filter(entry => entry.at >= since).length},
    feedback: said.map(({at, version, text}) => ({at, version, text}))},
  {headers: {'Cache-Control': 'no-store'}});
}
