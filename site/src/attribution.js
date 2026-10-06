// Where a downloaded app came from. The Download buttons give the app no channel (only the Terminal command's ?src= does,
// src/install.js), so each download click keeps a salted hash of its network address (downloads.net), and the app's first start asks
// GET /api/attribution?platform=mac|windows: the source of the latest click from the same network and platform in the last 7 days.
// The answer is a label ("linkedin.com", "reddit-devops", "direct"), never data about anyone; the hashes are deleted after 8 days.
// Two people downloading from one office network in a week can be mixed up: a channel count, not a fact about a person.
const DAY = 86400000;
export const WINDOW_DAYS = 7, KEEP_DAYS = 8;
const SLUG = /^[a-z0-9][a-z0-9_.-]{0,39}$/;   // = desktop/lib/install-source.js

export async function net(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (!ip) return null;
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${env.STATS_SALT || ''}|net|${ip}`)));
  return [...hash.slice(0, 12)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function attribution(request, env, now = new Date()) {
  const platform = new URL(request.url).searchParams.get('platform');
  if (request.method !== 'GET' || !['mac', 'windows'].includes(platform)) return new Response('Not found', {status: 404});
  const headers = {'Cache-Control': 'no-store'};
  const hash = env.STATS && await net(request, env);
  if (!hash) return Response.json({source: null}, {headers});
  const row = await env.STATS.prepare('SELECT source FROM downloads WHERE net = ? AND platform = ? AND at >= ? ORDER BY at DESC LIMIT 1')
    .bind(hash, platform, new Date(now.getTime() - WINDOW_DAYS * DAY).toISOString()).first();
  const source = String(row?.source || '').toLowerCase();
  console.log(JSON.stringify({area: 'attribution', platform, matched: !!row, source: SLUG.test(source) ? source : null}));
  return Response.json({source: SLUG.test(source) ? source : null}, {headers});
}

// The daily cron: network hashes older than 8 days are dropped (the download rows stay, as counts).
export async function purge(env, now = new Date()) {
  if (!env.STATS) return;
  await env.STATS.prepare('UPDATE downloads SET net = NULL WHERE net IS NOT NULL AND at < ?').bind(new Date(now.getTime() - KEEP_DAYS * DAY).toISOString()).run();
}
