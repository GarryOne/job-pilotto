// The website: static pages (public/), POST /api/waitlist, stats (src/stats.js: /download/*, /api/hit, /stats), and "Connect with Notion" for the app (src/notion.js).
// POST /api/waitlist which keeps Pro early-access
// sign-ups in Cloudflare KV (binding WAITLIST). List them: npx wrangler@4 kv key list --binding WAITLIST --remote
// Optional: with TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID set as secrets, each new sign-up is also sent to Telegram.
import * as notion from './notion.js';
import * as stats from './stats.js';
import * as telemetry from './telemetry.js';
import {install} from './install.js';
import {signals} from './signals.js';
import {feedback, view as feedbackView} from './feedback.js';
import {trial} from './trial.js';
import {brain} from './brain.js';
import {index as employerIndex} from './employers.js';
import * as pool from './pool.js';
import {handleReport} from '../../worker/src/report.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PER_HOUR = 10;  // sign-ups accepted from one address per hour

const json = (status, body) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});

export async function waitlist(request, env) {
  if (request.method !== 'POST') return json(405, {ok: false, error: 'Use POST'});
  let form;
  try { form = await request.json(); } catch { return json(400, {ok: false, error: 'Send JSON'}); }
  if (form.website) return json(200, {ok: true});  // honeypot field that people never see: a bot
  const email = String(form.email || '').trim().toLowerCase();
  const role = String(form.role || '').trim().slice(0, 200);
  if (email.length > 254 || !EMAIL.test(email)) return json(400, {ok: false, error: 'Enter an email address like you@example.com.'});

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const recent = Number(await env.WAITLIST.get(`rate:${ip}`)) || 0;
  if (recent >= PER_HOUR) return json(429, {ok: false, error: 'Too many sign-ups from here. Try again in an hour.'});
  await env.WAITLIST.put(`rate:${ip}`, String(recent + 1), {expirationTtl: 3600});

  const key = `signup:${email}`;
  if (await env.WAITLIST.get(key)) return json(200, {ok: true, already: true});
  const entry = {email, role, at: new Date().toISOString(), country: request.cf?.country || ''};
  await env.WAITLIST.put(key, JSON.stringify(entry), {metadata: {at: entry.at, role}});
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({chat_id: env.TELEGRAM_CHAT_ID, text: `✈️ Pro early access: ${email}${role ? ` · ${role}` : ''}`})}).catch(() => {});
  }
  return json(200, {ok: true});
}

// Form-structure reports from every Job Pilotto app (desktop/lib/reports.js; worker/src/report.js checks them):
// they start the public repo's intake workflow. Secrets GITHUB_TOKEN (dispatch) and REPORT_TOKEN (the owner's
// app, trusted); GITHUB_REPO in wrangler.toml.
export async function dispatch(env, inputs, workflow, fetcher = fetch) {
  const response = await fetcher(`https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${workflow}/dispatches`, {
    method: 'POST', body: JSON.stringify({ref: 'main', inputs}),
    headers: {Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'job-pilotto-site',
      'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json'}});
  if (response.status !== 204) throw new Error(`GitHub dispatch failed: ${response.status}`);
}

export default {
  async fetch(request, env, ctx) {
    const {pathname} = new URL(request.url);
    if (pathname.startsWith('/download/')) return stats.download(request, env, ctx);
    if (pathname === '/install') return install(request, env, ctx, stats.record);
    if (pathname === '/api/hit') return stats.hit(request, env);
    if (pathname === '/stats') return stats.stats(request, env);
    if (pathname === '/report/fill-failure') return handleReport(request, env, dispatch);
    if (pathname === '/report/telemetry') return telemetry.collect(request, env);
    if (pathname === '/telemetry') return telemetry.view(request, env);
    if (pathname === '/api/index') return employerIndex(request, env);
    if (pathname === '/api/contribute') return pool.contribute(request, env);
    if (pathname === '/api/contributions') return pool.aggregate(request, env);
    if (pathname === '/api/signals') return signals(request, env);
    if (pathname === '/api/feedback') return feedback(request, env);
    if (pathname === '/feedback') return feedbackView(request, env);
    if (pathname.startsWith('/api/ai/')) return trial(request, env);
    if (pathname === '/api/brain/telegram') return brain(request, env, dispatch);
    if (pathname === '/telemetry/version') return telemetry.evidence(request, env);
    if (pathname === '/api/waitlist') return waitlist(request, env);
    if (pathname === '/api/notion/start') return notion.start(request, env);
    if (pathname === notion.CALLBACK) return notion.callback(request, env);
    if (pathname === '/api/notion/token') return notion.collect(request, env);
    return env.ASSETS.fetch(request);
  },
  // Daily (wrangler.toml [triggers]): app reports older than 90 days dropped; the top problems go to GitHub triage.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(pool.purge(env).catch(error => console.error(`pool purge: ${error.message}`)));
    ctx.waitUntil(telemetry.daily(env, dispatch).catch(error => console.error(`telemetry triage: ${error.message}`)));
  },
};
