// The website: static pages (public/), POST /api/waitlist, stats (src/stats.js: /download/*, /api/hit, /stats), and "Connect with Notion" for the app (src/notion.js).
// POST /api/waitlist which keeps Pro early-access
// sign-ups in Cloudflare KV (binding WAITLIST). List them: npx wrangler@4 kv key list --binding WAITLIST --remote
// Optional: with TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID set as secrets, each new sign-up is also sent to Telegram.
import * as notion from './notion.js';
import * as stats from './stats.js';
import * as telemetry from './telemetry.js';
import {guard} from './guard.js';
import {view as intelligenceView} from './intelligence.js';
import {view as scoutingView} from './scoutingadmin.js';
import {ingest as selfHealIngest, view as selfHealView} from './selfheal.js';
import {ingest as jobCostIngest, view as jobCostView} from './jobcost.js';
import {digestView, view as formLearningView} from './formlearning.js';
import {adminPage, redirectOld} from './admin.js';
import {reportFile as e2eReportFile, view as e2eView} from './e2e.js';
import {view as overviewView} from './overview.js';
import {view as accessView} from './access.js';
import {join, viewer} from './auth.js';
import {aliases, evaluateAliases, evaluateVerifiedAliases, pack as aliasPack} from './aliases.js';
import {tidy as tidyIntelligence} from './intelligence.js';
import {knowledge, tidy as tidyKnowledge} from './knowledge.js';
import {playbook} from './playbook.js';
import {install} from './install.js';
import {signals} from './signals.js';
import {feedback, view as feedbackView} from './feedback.js';
import * as recipeLibrary from './recipes.js';
import * as triageQueue from './triage.js';
import {trial} from './trial.js';
import {brain} from './brain.js';
import {attribution, purge as purgeNets} from './attribution.js';
import {log as brainLog, view as brainView} from './brainlog.js';
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

// Form-structure reports from every Job Pilotto app (desktop/lib/reports.js; worker/src/report.js checks them): a failure that
// recurs is queued for the private repo's triage (src/triage.js). Secrets GITHUB_TOKEN (the product brain's dispatch) and
// REPORT_TOKEN (the owner's app, trusted); GITHUB_REPO in wrangler.toml.
export async function dispatch(env, inputs, workflow, fetcher = fetch) {
  // Recurring failures and problems are queued for the private repo's triage to pull (src/triage.js); other workflows (the
  // product brain's) are still started on GitHub.
  if (triageQueue.queued(workflow)) return triageQueue.queue(env, inputs, workflow);
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
    // The owner's admin pages (src/admin.js): one menu on all, the same key; never in public/, or they would be served to anyone.
    const admin = {'/admin': overviewView, '/admin/website': stats.stats, '/admin/app': telemetry.view, '/admin/insights': intelligenceView, '/admin/scouting': scoutingView,
      '/admin/self-healing': selfHealView, '/admin/ai-cost': jobCostView, '/admin/form-filling': formLearningView, '/admin/feedback': feedbackView,
      '/admin/access': accessView, '/admin/e2e': e2eView, '/admin/brain': brainView}[pathname];   // access: the super admin's only (src/access.js)
    if (pathname.startsWith('/admin/e2e/trace/')) return e2eView(request, env);   // a trace file for the viewer (public/trace-viewer/)
    if (pathname.startsWith('/admin/e2e/run/')) return e2eView(request, env);   // a run's HTML report (the link on GitHub's Summary page)
    if (pathname.startsWith('/admin/e2e/report/')) return e2eReportFile(request, env);   // its files: a signed address, no cookie needed (src/e2e.js)
    if (pathname === '/admin/join') return join(request, env);   // an invite link, opened once
    if (pathname === '/admin/form-filling/digest.json' || pathname === '/admin/form-filling/digest.md') return digestView(request, env);
    if (admin) {
      const who = await viewer(request, env);
      return adminPage(await admin(request, env), pathname, who || undefined);
    }
    const moved = await redirectOld(request, env);   // /stats, /telemetry, /intel, /self-heal, /ai-cost, /smart-form-filling, /feedback
    if (moved) return moved;
    if (pathname === '/report/fill-failure') return handleReport(request, env, dispatch);
    if (pathname === '/report/telemetry') return telemetry.collect(request, env);
    if (pathname === '/self-heal/data' && request.method === 'PUT') return selfHealIngest(request, env);   // CI publishes the loop's numbers (Bearer SELFHEAL_PUBLISH_KEY)
    if (pathname === '/ai-cost/data' && request.method === 'PUT') return jobCostIngest(request, env);   // each scheduled job reports its AI cost (Bearer AI_COST_PUBLISH_KEY)
    if (pathname === '/api/index') return employerIndex(request, env);
    if (pathname === '/api/recipes') return recipeLibrary.recipes(request, env);
    if (pathname === '/api/recipes/lookup') return recipeLibrary.lookup(request, env);
    if (pathname === '/api/recipes/targets') return recipeLibrary.targets(request, env);
    if (pathname === '/api/guard') return guard(request, env);
    if (pathname === '/api/knowledge') return knowledge(request, env);
    if (pathname === '/api/packs/aliases') return aliasPack(request, env);
    if (pathname === '/api/aliases') return aliases(request, env);
    if (pathname === '/api/playbook') return playbook(request, env);
    if (pathname === '/api/install-token') return recipeLibrary.installToken(request, env);
    if (pathname === '/api/controls') return recipeLibrary.controls(request, env);
    if (pathname === '/api/lab') return recipeLibrary.lab(request, env);
    if (pathname === '/api/triage') return triageQueue.triage(request, env);
    if (pathname === '/api/contribute') return pool.contribute(request, env);
    if (pathname === '/api/contributions') return pool.aggregate(request, env);
    if (pathname === '/api/signals') return signals(request, env);
    if (pathname === '/api/feedback') return feedback(request, env);
    if (pathname === '/api/attribution') return attribution(request, env);   // a downloaded app's first start: its channel
    if (pathname.startsWith('/api/ai/')) return trial(request, env);
    if (pathname === '/api/brain/telegram') return brain(request, env, dispatch);
    if (pathname === '/api/brain/log') return brainLog(request, env);   // tools/product_brain.py, the scripts' key
    if (pathname === '/telemetry/version') return telemetry.evidence(request, env);
    if (pathname === '/api/waitlist') return waitlist(request, env);
    if (pathname === '/api/notion/start') return notion.start(request, env);
    if (pathname === notion.CALLBACK) return notion.callback(request, env);
    if (pathname === '/api/notion/token') return notion.collect(request, env);
    return env.ASSETS.fetch(request);
  },
  // Daily (wrangler.toml [triggers]): app reports older than 90 days dropped; the top problems go to GitHub triage.
  async scheduled(event, env, ctx) {
    // The day's totals first (kept for good), then the 90-day purge of raw rows.
    ctx.waitUntil(pool.rollup(env).catch(error => console.error(`pool rollup: ${error.message}`)).then(() => pool.purge(env)).catch(error => console.error(`pool purge: ${error.message}`)));
    ctx.waitUntil((env.STATS ? recipeLibrary.evaluateCanary(env.STATS) : Promise.resolve([])).then(actions => { if (actions.length) console.log(`recipes: ${JSON.stringify(actions)}`); })
      .catch(error => console.error(`recipe canary: ${error.message}`)));
    ctx.waitUntil((env.STATS ? Promise.all([recipeLibrary.evaluateVerified(env.STATS), evaluateVerifiedAliases(env.STATS)]).then(done => done.flat()) : Promise.resolve([])).then(actions => { if (actions.length) console.log(`rolled back: ${JSON.stringify(actions)}`); })
      .catch(error => console.error(`verified watch: ${error.message}`)));
    ctx.waitUntil(purgeNets(env).catch(error => console.error(`download nets purge: ${error.message}`)));
    ctx.waitUntil(telemetry.daily(env, dispatch).catch(error => console.error(`telemetry triage: ${error.message}`)));
    ctx.waitUntil((env.STATS ? evaluateAliases(env.STATS) : Promise.resolve([])).then(actions => { if (actions.length) console.log(`aliases: ${JSON.stringify(actions)}`); })
      .catch(error => console.error(`alias canary: ${error.message}`)));
    ctx.waitUntil((env.STATS ? tidyIntelligence(env.STATS) : Promise.resolve({dropped: 0})).catch(error => console.error(`intelligence tidy: ${error.message}`)));
    ctx.waitUntil((env.STATS ? tidyKnowledge(env.STATS) : Promise.resolve({dropped: 0})).catch(error => console.error(`knowledge tidy: ${error.message}`)));
  },
};
