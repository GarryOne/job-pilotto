// The website: static pages (public/), POST /api/waitlist, stats (src/stats.js: /download/*, /api/hit, /stats), and "Connect with Notion" for the app (src/notion.js).
// POST /api/waitlist which keeps Pro early-access
// sign-ups in Cloudflare KV (binding WAITLIST). List them: npx wrangler@4 kv key list --binding WAITLIST --remote
// Optional: with TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID set as secrets, each new sign-up is also sent to Telegram.
import {videoIngest, videoView} from './lab-video.js';
import * as sentryAlert from './sentry-alert.js';
import {replaysIngest} from './applying-replays.js';
import {fidelityIngest} from './applying-fidelity.js';
import {verifyIngest} from './applying-verify.js';
import {endingsIngest} from './applying-resolution.js';
import {ciRowsIngest} from './applying-ci-rows.js';
import {view as searchLabView} from './search-lab-page.js';
import {ingestRoute as searchLabIngest} from './search-lab-store.js';
import {ingestRoute as searchLabDrawIngest} from './search-lab-draws.js';
import {discoveryInput} from './discovery-candidates.js';
import {meter, newTally, requestLine} from './d1-meter.js';
import {apexRedirect, legacyPageRedirect} from './hosts.js';
import * as linkedin from './linkedin.js';
import * as notion from './notion.js';
import * as stats from './stats.js';
import * as telemetry from './telemetry.js';
import {guard} from './guard.js';
import {view as intelligenceView} from './intelligence.js';
import {view as scoutingView} from './scoutingadmin.js';
import {ingest as selfHealIngest, view as selfHealView} from './selfheal.js';
import {ingest as opsIngest, view as opsView} from './ops-overview.js';
import {ingest as e2eIntelIngest} from './e2e-intel.js';
import {ingest as changelogIngest, list as changelogList} from './changelog-store.js';
import {view as e2eIntelView} from './e2e-page.js';
import {ingest as buildLogIngest, view as buildLogView} from './build-log.js';
import {ingest as prChecksIngest, view as prChecksView} from './pr-checks.js';
import {view as monetizationView} from './monetization.js';
import {launchRoute, view as signupsView} from './signups.js';
import * as mailLifecycle from './mail-lifecycle.js';
import {ingest as benchmarkIngest, view as benchmarkView} from './benchmark.js';
import {ingest as jobCostIngest, spent as jobCostSpent, view as jobCostView} from './jobcost.js';
import {digestView, view as realFormFillingView} from './real-form-filling.js';
import {view as formLearningView} from './form-learning.js';
import {adminPage, redirectOld} from './admin.js';
import {reportFile as e2eReportFile, view as e2eView} from './e2e-report.js';
import {view as applyingView} from './applying.js';
import {view as sentryView} from './sentry.js';
import {view as overviewView} from './overview.js';
import {overviewView as sectionOverview} from './section-overview.js';
import {view as accessView} from './access.js';
import {join, viewer} from './auth.js';
import {aliases, evaluateAliases, evaluateVerifiedAliases, pack as aliasPack, pruneLearning} from './aliases.js';
import {evaluateMeanings} from './meanings.js';
import {tidy as tidyIntelligence} from './intelligence.js';
import {knowledge, tidy as tidyKnowledge} from './knowledge.js';
import {playbook} from './playbook.js';
import {install} from './install.js';
import {signals} from './signals.js';
import {feedback, view as feedbackView} from './feedback.js';
import {reportForm} from './report-form.js';
import {view as reportsView} from './report-view.js';
import * as recipeLibrary from './recipes.js';
import * as triageQueue from './triage.js';
import {freeAi} from './free-ai.js';
import * as mail from './mail.js';
import * as mailUnsub from './mail-unsub.js';
import * as mailHeld from './mail-held.js';
import * as mailSettings from './mail-settings.js';
import * as accountEmail from './account-email.js';
import {status as proStatus} from './pro.js';
import * as proSignin from './pro-signin.js';
import {status as trialStatus} from './trial.js';
import * as hosted from './hosted.js';
import * as hostedState from './hosted-state.js';
import {tick as hostedTick} from './hosted-tick.js';
import {ready, sweep as readySweep} from './ready.js';
import {tick as readyTick} from './ready-tick.js';
import {checkout as proCheckout, webhook as proWebhook} from './pro-pay.js';
import {isReleasesPath, releases} from './releases.js';
import {brain} from './brain.js';
import {attribution, purge as purgeNets} from './attribution.js';
import {log as brainLog, view as brainView} from './brainlog.js';
import {index as employerIndex} from './employers.js';
import * as pool from './pool.js';
import * as testMail from './test-mail.js';   // test-account-*@ inboxes for the tests (Email Worker + /admin/test-mail)
import {handleReport} from '../../worker/src/report.js';
import {movesView} from './ladder-moves.js';

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
  const source = form.source === 'app' ? 'app' : 'web';   // the Plan screen in the Desktop App says "app"; the website form says nothing
  const entry = {email, role, source, at: new Date().toISOString(), country: request.cf?.country || ''};
  await env.WAITLIST.put(key, JSON.stringify(entry), {metadata: {at: entry.at, role, source}});
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({chat_id: env.TELEGRAM_CHAT_ID, text: `✈️ Pro early access: ${email}${role ? ` · ${role}` : ''}${source === 'app' ? ' · from the app' : ''}`})}).catch(() => {});
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

// The learning judges (canary recipes, aliases, meanings) run daily with the cron, and also when fill data arrives, at most once an hour per
// worker instance (in memory: no KV write). 9 Oct 2026: a second, hourly cron broke the deploy (the account's cron triggers are all used).
export const JUDGE_EVERY_MS = 60 * 60 * 1000;
let judgedAt = 0;
export function judgeSoon(env, ctx, now = Date.now()) {
  if (!env.STATS || now - judgedAt < JUDGE_EVERY_MS) return false;
  judgedAt = now;
  ctx?.waitUntil?.(judgeLearning(env.STATS).catch(error => console.error(`learning judges: ${error.message}`)));
  return true;
}
export const _resetJudge = () => { judgedAt = 0; };   // tests
export async function judgeLearning(db, now = new Date()) {
  const [recipes, meanings, aliases] = await Promise.all([recipeLibrary.evaluateCanary(db, now), evaluateMeanings(db, now), evaluateAliases(db, now)]);
  const actions = {recipes, meanings, aliases};
  if (recipes.length || meanings.length || aliases.length) console.log(`learning: ${JSON.stringify(actions)}`);
  return actions;
}

// Every request runs against a metered database (src/d1-meter.js): its rows read and written, its route and its caller go to Workers Logs as one JSON line.
async function metered(request, env, ctx) {
  const tally = newTally(), withMeter = env.STATS ? {...env, STATS: meter(env.STATS, tally)} : env;
  let status = 500;
  try { const response = await route(request, withMeter, ctx); status = response.status; return response; } finally { const line = requestLine(request, status, tally); if (line) console.log(line); }
}

async function route(request, env, ctx) {
  const alias = apexRedirect(request);   // jobpilotto.top -> www.jobpilotto.top; workers.dev is never redirected (src/hosts.js)
  if (alias) return alias;
  const legacy = legacyPageRedirect(request);   // a page on the old www.jobpilotto.top -> www.jobadabra.top; its API paths are served as before
  if (legacy) return legacy;
  const {pathname} = new URL(request.url);
  if (pathname.startsWith('/download/')) return stats.download(request, env, ctx);
  if (pathname === '/install') return install(request, env, ctx, stats.record);
  if (pathname === '/api/hit') return stats.hit(request, env);
  if (isReleasesPath(pathname)) return releases(request, env, ctx);   // the app's update check (src/releases.js)
  if (pathname === '/admin/mail/launch') return launchRoute(request, env);   // the Pro-launch mail, by hand (src/signups.js)
  if (pathname === '/admin/test-mail') return testMail.view(request, env);   // Bearer only (src/test-mail.js)
  // The owner's admin pages (src/admin.js): one menu on all, the same key; never in public/, or they would be served to anyone.
  const admin = {'/admin': overviewView, '/admin/website': stats.stats, '/admin/app': telemetry.view, '/admin/insights': intelligenceView, '/admin/scouting': scoutingView,
    '/admin/operations/overview': opsView, '/admin/form-overview': sectionOverview('/admin/form-overview', 'Form filling overview'), '/admin/growth-overview': sectionOverview('/admin/growth-overview', 'Growth overview'), '/admin/intelligence-overview': sectionOverview('/admin/intelligence-overview', 'Intelligence overview'), '/admin/operations/build-log': buildLogView, '/admin/operations/pr-checks': prChecksView, '/admin/operations/e2e': e2eIntelView, '/admin/self-healing': selfHealView, '/admin/ai-cost': jobCostView, '/admin/monetization': monetizationView, '/admin/signups': signupsView, '/admin/real-form-filling': realFormFillingView, '/admin/form-learning': formLearningView, '/admin/feedback': feedbackView,
    '/admin/access': accessView, '/admin/lab-form-filling': applyingView, '/admin/lab-job-search': searchLabView, '/admin/benchmark-form-filling': benchmarkView, '/admin/brain': brainView, '/admin/sentry': sentryView, '/admin/reports': reportsView}[pathname];   // access: the super admin's only (src/access.js)
  if (pathname === '/admin/e2e' || pathname.startsWith('/admin/e2e/run/')) return e2eView(request, env);   // a run's HTML report (the link on GitHub's Summary page); the dropped runs page redirects (src/e2e-report.js)
  if (pathname.startsWith('/admin/e2e/report/')) return e2eReportFile(request, env);   // its files: a signed address, no cookie needed (src/e2e-report.js)
  if (pathname === '/admin/join') return join(request, env);   // an invite link
  if (pathname === '/admin/real-form-filling/digest.json' || pathname === '/admin/real-form-filling/digest.md') return digestView(request, env);
  if (admin) {
    const who = await viewer(request, env);
    return adminPage(await admin(request, env), pathname, who || undefined);
  }
  const moved = await redirectOld(request, env);   // the old page addresses listed in src/admin.js
  if (moved) return moved;
  if (pathname === '/report/fill-failure') return handleReport(request, env, dispatch);
  if (pathname === '/report/telemetry') return telemetry.collect(request, env);
  if (pathname === '/applying/verify' && request.method === 'PUT') return verifyIngest(request, env);   // "Confirmed offline" verdicts (Bearer REPLAYS_PUBLISH_KEY, src/applying-verify.js)
  if (pathname === '/applying/fidelity' && request.method === 'PUT') return fidelityIngest(request, env);   // a prototype's replay-vs-live records (Bearer REPLAYS_PUBLISH_KEY, src/applying-fidelity.js)
  if (pathname === '/applying/ci-rows' && request.method === 'PUT') return ciRowsIngest(request, env);   // a CI recording run's rows, main only (Bearer REPLAYS_PUBLISH_KEY, src/applying-ci-rows.js)
  if (pathname === '/search-lab/draws' && request.method === 'PUT') return searchLabDrawIngest(request, env);   // the daily CI draw, main only (Bearer REPLAYS_PUBLISH_KEY, src/search-lab-draws.js)
  if (pathname === '/search-lab/rows' && request.method === 'PUT') return searchLabIngest(request, env);   // a replayed search per candidate, main only (Bearer REPLAYS_PUBLISH_KEY, src/search-lab-store.js)
  if (pathname === '/applying/discovery-input' && request.method === 'GET') return discoveryInput(request, env);   // the daily discovery batch's input (Bearer REPLAYS_PUBLISH_KEY, src/discovery-candidates.js)
  if (pathname === '/applying/endings' && request.method === 'PUT') return endingsIngest(request, env);
  if (pathname === '/applying/video' && request.method === 'PUT') return videoIngest(request, env);   // CI's pool run: one fill video per row (Bearer REPLAYS_PUBLISH_KEY, src/lab-video.js)
  if (pathname === '/admin/lab-form-filling/video' && request.method === 'GET') return videoView(request, env);   // the owner streams it (src/lab-video.js)
  if (pathname === '/applying/replays' && request.method === 'PUT') return replaysIngest(request, env);   // CI on main's recorded replays (Bearer REPLAYS_PUBLISH_KEY, src/applying-replays.js)
  if (pathname === '/e2e/data' && (request.method === 'PUT' || request.method === 'GET')) return e2eIntelIngest(request, env);   // CI publishes finished e2e runs and their red suites (Bearer SELFHEAL_PUBLISH_KEY, src/e2e-intel.js)
  if (pathname === '/changelog/data' && (request.method === 'PUT' || request.method === 'GET')) return changelogIngest(request, env);   // CI publishes each new version's What's new entry (Bearer SELFHEAL_PUBLISH_KEY, src/changelog-store.js)
  if (pathname === '/changelog.json' && request.method === 'GET') return changelogList(request, env);   // the What's new page's versions (falls back to public/changelog.json)
  if (pathname === '/ops/data' && (request.method === 'PUT' || request.method === 'GET')) return opsIngest(request, env);   // CI publishes merged PRs (Bearer SELFHEAL_PUBLISH_KEY, src/ops-overview.js)
  if (pathname === '/digest/data' && (request.method === 'PUT' || request.method === 'GET')) return buildLogIngest(request, env);   // CI publishes the day's build digest (Bearer SELFHEAL_PUBLISH_KEY, src/build-log.js)
  if (pathname === '/pr-checks/data' && request.method === 'PUT') return prChecksIngest(request, env);   // the monthly PR-check scorecard (Bearer SELFHEAL_PUBLISH_KEY, src/pr-checks.js)
  if (pathname === '/benchmark/data' && request.method === 'PUT') return benchmarkIngest(request, env);   // the bake-off's scored runs (Bearer SELFHEAL_PUBLISH_KEY, src/benchmark.js)
  if (pathname === '/self-heal/data' && request.method === 'PUT') return selfHealIngest(request, env);   // CI publishes the loop's numbers (Bearer SELFHEAL_PUBLISH_KEY)
  if (pathname === '/ai-cost/data' && request.method === 'GET') return jobCostSpent(request, env);   // a day's reported spend for CI's budget guard (same key)
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
  if (pathname === '/api/ladder-moves') return movesView(request, env);   // the owner: the ladder's learned moves per source (src/ladder-moves.js)
  if (pathname === '/api/controls') { judgeSoon(env, ctx); return recipeLibrary.controls(request, env); }   // fill data in: the judges may act on it
  if (pathname === '/api/triage') return triageQueue.triage(request, env);
  if (pathname === '/api/contribute') return pool.contribute(request, env);
  if (pathname === '/api/contributions') return pool.aggregate(request, env);
  if (pathname === '/api/signals') return signals(request, env);
  if (pathname === '/api/feedback') return feedback(request, env);
  if (pathname === '/api/report-form' || pathname.startsWith('/api/report-form/')) return reportForm(request, env, pathname);   // "Report this form": an encrypted recording from an install (src/report-form.js)
  if (pathname === '/api/attribution') return attribution(request, env);   // a downloaded app's first start: its channel
  if (pathname.startsWith('/api/ai/')) return freeAi(request, env, new Date(), ctx);
  if (pathname === '/email-settings') return mailSettings.settings(request, env);   // the signed e-mail settings page (src/mail-settings.js)
  if (pathname === '/unsubscribe') return mailUnsub.unsubscribe(request, env);   // one-click unsubscribe from a mail list (src/mail-unsub.js)
  if (pathname === '/confirm') return accountEmail.confirm(request, env);   // confirm an e-mail address (src/account-email.js)
  if (pathname === '/api/account/email') return accountEmail.address(request, env);   // the person's address and marketing opt-in (src/account-email.js)
  if (pathname === '/api/notify/email') return accountEmail.notify(request, env);   // a Telegram-style message by e-mail (src/account-email.js)
  if (pathname === '/api/trial/status') return trialStatus(request, env);   // the free trial, one answer for the app and Always on (src/trial.js)
  if (pathname === '/api/hosted/schedule') return hosted.schedule(request, env);   // hosted Always on: the install's schedule (src/hosted.js; 404 while HOSTED_ALWAYS_ON is off)
  if (pathname === '/api/hosted/result') return hosted.result(request, env);   // a container's one result post (run token)
  if (pathname === '/api/hosted/state') return hostedState.state(request, env);   // the container's state, encrypted in R2 (src/hosted-state.js)
  if (pathname === '/api/hosted/config') return hostedState.config(request, env);   // profile, search and CV text the app pushes; the container reads
  if (pathname === '/api/hosted/export' || pathname === '/api/hosted/data') return hostedState.own(request, env);   // download and delete my hosted data
  if (pathname.startsWith('/api/ready/')) return ready(request, env);   // Ready to send, phase 1: the owner's night batch and morning rows (src/ready.js; 404 while READY_TO_SEND is off)
  if (pathname === '/api/hosted/inbox') return hosted.inbox(request, env);   // the matches that arrived while the app was closed
  if (pathname === '/api/pro/checkout') return proCheckout(request, env);   // a one-time payment for Pro or a top-up (src/pro-pay.js)
  if (pathname === '/api/pro/webhook') return proWebhook(request, env);   // the payment provider's signed events
  if (pathname === '/api/pro/signin/start') return proSignin.start(request, env);   // "I have Pro": a 6-digit code by e-mail (src/pro-signin.js)
  if (pathname === '/api/pro/signin/verify') return proSignin.verify(request, env);   // the code adds this install to the Pro account
  if (pathname === '/api/pro/status') return proStatus(request, env);   // the Pro plan: plan and AI credit for the app (src/pro.js)
  if (pathname === '/api/brain/telegram') return brain(request, env, dispatch);
  if (pathname === '/api/brain/log') return brainLog(request, env);   // tools/product_brain.py, the scripts' key
  if (pathname === '/telemetry/version') return telemetry.evidence(request, env);
  if (pathname === '/api/waitlist') return waitlist(request, env);
  if (pathname === '/api/notion/start') return notion.start(request, env);
  if (pathname === notion.CALLBACK) return notion.callback(request, env);
  if (pathname === '/api/notion/token') return notion.collect(request, env);
  if (pathname === '/api/linkedin/start') return linkedin.start(request, env);
  if (pathname === linkedin.CALLBACK) return linkedin.callback(request, env);
  if (pathname === '/api/linkedin/token') return linkedin.collect(request, env);
  return env.ASSETS.fetch(request);
}

const SENTRY_CRON = '*/5 * * * *';   // wrangler.toml [triggers]

export default {
  fetch: metered,
  email: (message, env) => testMail.receive(message, env),   // Cloudflare Email Routing -> this Worker (dashboard route, src/test-mail.js)
  queue: (batch, env) => mailUnsub.consume(batch, env),   // Email Sending bounce/complaint events (Queues subscription, src/mail-unsub.js)
  // Daily (wrangler.toml [triggers]): app reports older than 90 days dropped; the top problems go to GitHub triage.
  async scheduled(event, env, ctx) {
    if (event.cron === SENTRY_CRON) {   // every 5 minutes: only the Sentry alerts (src/sentry-alert.js); the daily jobs below run once a day
      ctx.waitUntil(hostedTick(env).then(done => { if (done.enqueued || Object.keys(done.paused).length) console.log(`hosted tick: ${JSON.stringify(done)}`); }).catch(error => console.error(`hosted tick: ${error.message}`)));   // hosted Always on: due schedules to the Queue (src/hosted-tick.js; nothing while HOSTED_ALWAYS_ON is off)
      ctx.waitUntil(readyTick(env).then(done => { if (done.started || done.finished) console.log(`ready tick: ${JSON.stringify(done)}`); }).catch(error => console.error(`ready tick: ${error.message}`)));   // Ready to send: due nights to the Queue, over-time nights finished (src/ready-tick.js; nothing while READY_TO_SEND is off)
      ctx.waitUntil(readySweep(env).catch(error => console.error(`ready sweep: ${error.message}`)));   // Ready to send: a batch older than a day loses its data (src/ready.js)
      ctx.waitUntil(sentryAlert.check(env).catch(error => console.error(`sentry alert: ${error.message}`)));
      return;
    }
    ctx.waitUntil(sentryAlert.purge(env).catch(error => console.error(`sentry alert purge: ${error.message}`)));
    // The day's totals first (kept for good), then the 90-day purge of raw rows.
    ctx.waitUntil(pool.rollup(env).catch(error => console.error(`pool rollup: ${error.message}`)).then(() => pool.purge(env)).catch(error => console.error(`pool purge: ${error.message}`)));
    ctx.waitUntil((env.STATS ? recipeLibrary.evaluateCanary(env.STATS) : Promise.resolve([])).then(actions => { if (actions.length) console.log(`recipes: ${JSON.stringify(actions)}`); })
      .catch(error => console.error(`recipe canary: ${error.message}`)));
    ctx.waitUntil((env.STATS ? Promise.all([recipeLibrary.evaluateVerified(env.STATS), evaluateVerifiedAliases(env.STATS)]).then(done => done.flat()) : Promise.resolve([])).then(actions => { if (actions.length) console.log(`rolled back: ${JSON.stringify(actions)}`); })
      .catch(error => console.error(`verified watch: ${error.message}`)));
    ctx.waitUntil(purgeNets(env).catch(error => console.error(`download nets purge: ${error.message}`)));
    ctx.waitUntil(telemetry.daily(env, dispatch).catch(error => console.error(`telemetry triage: ${error.message}`)));
    ctx.waitUntil((env.STATS ? evaluateMeanings(env.STATS) : Promise.resolve([])).then(actions => { if (actions.length) console.log(`meanings: ${JSON.stringify(actions)}`); })
      .catch(error => console.error(`meanings canary: ${error.message}`)));
    ctx.waitUntil((env.STATS ? evaluateAliases(env.STATS) : Promise.resolve([])).then(actions => { if (actions.length) console.log(`aliases: ${JSON.stringify(actions)}`); })
      .catch(error => console.error(`alias canary: ${error.message}`)));
    ctx.waitUntil((env.STATS ? pruneLearning(env.STATS) : Promise.resolve({})).then(removed => console.log(`learning pruned: ${JSON.stringify(removed)}`)).catch(error => console.log(`learning not pruned: ${error.message}`)));   // aliases.js pruneLearning
    ctx.waitUntil((env.STATS ? tidyIntelligence(env.STATS) : Promise.resolve({dropped: 0})).catch(error => console.error(`intelligence tidy: ${error.message}`)));
    ctx.waitUntil(mailHeld.sendDigests(env).catch(error => console.error(`mail digests: ${error.message}`)));   // the daily or weekly digest (src/mail-held.js)
    ctx.waitUntil(mail.purge(env).catch(error => console.error(`mail log purge: ${error.message}`)));
    ctx.waitUntil(mailLifecycle.run(env).catch(error => console.error(`mail lifecycle: ${error.message}`)));   // trial reminders, Always on paused (src/mail-lifecycle.js)
    ctx.waitUntil(testMail.purge(env).catch(error => console.error(`test mail purge: ${error.message}`)));
    ctx.waitUntil((env.STATS ? tidyKnowledge(env.STATS) : Promise.resolve({dropped: 0})).catch(error => console.error(`knowledge tidy: ${error.message}`)));
  },
};
