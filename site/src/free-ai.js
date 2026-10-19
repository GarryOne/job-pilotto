// Free AI (owner, 16 Oct 2026): /api/ai/* answers the app's Anthropic-shaped calls with an open model on Workers AI (env.AI), for every install, no key.
// The app's "API key" is JPF1.<install>.<token> (a token minted by /api/install-token with purpose "ai"), so both SDKs carry it unchanged.
// Fair use per install (minute, day), a global daily line with a Telegram alert, and a kill switch (FREE_AI=off). Nothing is stored: not the request, not the answer.
import {record as recordCost} from './aicost.js';
import {authorize, digestOf} from './guard.js';
import {verifyLicense} from './license.js';
import {asStream, fromWorkersAi, toWorkersAi, Unsupported} from './free-ai-translate.js';
import {accountNeurons} from './free-ai-usage.js';
import {FREE_NEURONS_PER_DAY, costUsd, modelFor, neuronsOf} from './free-ai-models.js';
import {PRO_PER_MINUTE, chargeCall, proLane} from './pro-ai.js';
import {aiAccess} from './hosted-budget.js';
import {runOf} from './hosted.js';

// Per install (owner, 16 Oct 2026): 30 calls a minute, $0.30 a day and $3 a month (money, not calls), 1.5M tokens a day. Global: alert at $3 a day, stop at $10 a day, and a month line: alert at $40, stop at $60
// (the values in force are wrangler.toml's vars; these are the tight defaults. env FREE_AI_INSTALL_MINUTE_CALLS / FREE_AI_ALERT_USD / FREE_AI_STOP_USD / FREE_AI_MONTH_ALERT_USD / FREE_AI_MONTH_STOP_USD / FREE_AI_INSTALL_DAY_USD / FREE_AI_INSTALL_MONTH_USD).
export const LIMITS = {trialUsd: 2, perMinute: 30, installDayUsd: 0.3, installMonthUsd: 3, tokensPerDay: 1_500_000, alertUsd: 3, stopUsd: 10, monthAlertUsd: 40, monthStopUsd: 60};

const BUSY = 'Free AI is busy today. Try again tomorrow, or add your own key in Settings → AI engine (Claude or ChatGPT).';
const ADD_KEY = 'add your own Claude or ChatGPT key in Settings → AI engine.';
export const DAY_MESSAGE = `You reached today's Free AI use. It resets tomorrow, or ${ADD_KEY}`;
export const MONTH_MESSAGE = `You reached this month's Free AI use. It resets next month, or ${ADD_KEY}`;
export const TRIAL_MESSAGE = `You've used the Free AI included in your trial. Get Pro, or connect your own Claude or ChatGPT key in Settings → AI engine.`;
const BUSY_MONTH = `Free AI is busy this month. Try again next month, or ${ADD_KEY}`;
const error = (status, message, type = 'api_error') => Response.json({type: 'error', error: {type, message}}, {status});
const num = (value, fallback) => (Number(value) > 0 ? Number(value) : fallback);
// The two lines the admin Monetization page shows, read the same way the route enforces them.
export const monthStopUsd = env => num(env.FREE_AI_MONTH_STOP_USD, LIMITS.monthStopUsd);
export const trialUsd = env => num(env.FREE_AI_TRIAL_USD, LIMITS.trialUsd);
const count = async (kv, key) => Number(await kv.get(key)) || 0;

export const parseKey = key => { const [tag, install, token] = String(key || '').split('.'); return tag === 'JPF1' && install && token ? {install, token} : null; };

// Apps from before Free AI still send their founder/friend key (JP1.…): it works the same until they update.
async function who(key, env, now = new Date()) {
  if (String(key || '').startsWith('HR1.') && env.HOSTED_ALWAYS_ON === 'on') return aiAccess(env, key, runOf, now);   // a hosted container's run token: charged as the install that set the schedule (src/hosted-budget.js)
  const given = parseKey(key);
  if (given) { const access = await authorize(env, given.install, given.token, 'ai'); return access.ok ? {...access, install: given.install} : null; }   // a trial install: its lifetime budget applies
  const license = String(key || '').startsWith('JP1.') && await verifyLicense(key, env.LICENSE_PUBLIC_KEY);
  return license ? {ok: true, who: await digestOf(`license:${license.id}`), license: true} : null;   // Pro / founder / friend: a separate lane, no trial budget
}

export async function freeAi(request, env, now = new Date(), ctx = null, fetcher = fetch) {
  const path = new URL(request.url).pathname.replace(/^\/api\/ai/, '');
  if (env.FREE_AI === 'off') return error(503, 'Free AI is paused right now. You can add your own key in Settings → AI engine.');
  if (!env.AI || !env.WAITLIST) return error(503, 'Free AI is not available right now.');
  const access = await who(request.headers.get('x-api-key'), env, now);
  if (!access) return error(401, 'Free AI needs this install\'s token. Restart Jobadabra and try again.', 'authentication_error');
  if (path === '/v1/models' && request.method === 'GET') return Response.json({data: [], has_more: false});   // key checks
  if (path !== '/v1/messages' || request.method !== 'POST') return error(404, 'Not available with Free AI.', 'not_found_error');
  const pro = await proLane(env, access.install);   // a Pro account with credit: its own lane (src/pro-ai.js); null = the Free rules
  if (pro?.blocked) return error(402, pro.blocked, 'billing_error');

  const kv = env.WAITLIST, day = now.toISOString().slice(0, 10), month = day.slice(0, 7), minute = now.toISOString().slice(0, 16);
  const keys = {minute: `freeai:min:${access.who}:${minute}`, dayUsd: `freeai:dusd:${access.who}:${day}`, monthUsd: `freeai:musd:${access.who}:${month}`, tokens: `freeai:tok:${access.who}:${day}`, usd: `freeai:usd:${day}`, globalMonth: `freeai:usdm:${month}`, neurons: `freeai:neu:${day}`, life: `freeai:life:${access.who}`};
  const [perMinute, installDay, installMonth, tokens, microUsd, globalMonth, neurons, life] = await Promise.all(Object.values(keys).map(key => count(kv, key)));
  if (!pro && microUsd >= num(env.FREE_AI_STOP_USD, LIMITS.stopUsd) * 1e6) return error(503, BUSY);
  if (!pro && globalMonth >= monthStopUsd(env) * 1e6) return error(503, BUSY_MONTH);
  const allowance = env.FREE_AI_NEURONS === 'off' ? Infinity : num(env.FREE_AI_NEURONS, FREE_NEURONS_PER_DAY);
  const account = await accountNeurons(env, kv, day, now, fetcher), seen = Math.max(neurons, account ?? 0);   // the account's own count includes every caller
  if (!pro && seen >= allowance) return error(503, BUSY);
  if (perMinute >= (pro ? PRO_PER_MINUTE : num(env.FREE_AI_INSTALL_MINUTE_CALLS, LIMITS.perMinute))) return error(429, 'Free AI: too many requests in a minute. Jobadabra will retry.', 'rate_limit_error');
  if (!pro && !access.license && life >= trialUsd(env) * 1e6) return error(429, TRIAL_MESSAGE, 'rate_limit_error');
  if (!pro && installMonth >= num(env.FREE_AI_INSTALL_MONTH_USD, LIMITS.installMonthUsd) * 1e6) return error(429, MONTH_MESSAGE, 'rate_limit_error');
  if (!pro && (installDay >= num(env.FREE_AI_INSTALL_DAY_USD, LIMITS.installDayUsd) * 1e6 || tokens >= LIMITS.tokensPerDay)) return error(429, DAY_MESSAGE, 'rate_limit_error');

  let body;
  try { body = await request.json(); } catch { return error(400, 'Bad request.', 'invalid_request_error'); }
  const model = modelFor(request.headers.get('x-jp-action'), env);
  let result;
  try {
    const readPdf = async base64 => {
      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      const [page] = await env.AI.toMarkdown([{name: 'cv.pdf', blob: new Blob([bytes], {type: 'application/pdf'})}]);
      return page?.data || '';
    };
    const input = await toWorkersAi(body, readPdf);
    result = await env.AI.run(model, input);
    // Live (16 Oct 2026, 1 of 30): the model looped on whitespace to the token limit. A structured ask gets one more try, and both attempts are paid for.
    if (input.response_format && !isJson(fromWorkersAi(result, model).content[0].text)) {
      const first = fromWorkersAi(result, model).usage, again = await env.AI.run(model, {...input, temperature: body.temperature ?? 0.3});
      if (!isJson(fromWorkersAi(again, model).content[0].text)) return error(502, 'Free AI could not answer just now.');
      result = {...again, usage: {prompt_tokens: (again.usage?.prompt_tokens || 0) + first.input_tokens, completion_tokens: (again.usage?.completion_tokens || 0) + first.output_tokens}};
    }
  } catch (caught) {
    if (/daily free allocation|4006/i.test(String(caught?.message))) return error(503, BUSY);
    if (caught instanceof Unsupported) return error(422, `${caught.message} Add your own key in Settings → AI engine for this step.`, 'invalid_request_error');
    return error(502, 'Free AI could not answer just now.');
  }
  const message = fromWorkersAi(result, model);
  const used = message.usage.input_tokens + message.usage.output_tokens, usd = costUsd(model, message.usage);
  const after = Math.round(usd * 1e6);
  const work = Promise.all([
    kv.put(keys.minute, String(perMinute + 1), {expirationTtl: 120}), kv.put(keys.dayUsd, String(installDay + after), {expirationTtl: 2 * 86400}), kv.put(keys.monthUsd, String(installMonth + after), {expirationTtl: 40 * 86400}), kv.put(keys.globalMonth, String(globalMonth + after), {expirationTtl: 40 * 86400}), ...(access.license ? [] : [kv.put(keys.life, String(life + after))]),
    kv.put(keys.tokens, String(tokens + used), {expirationTtl: 2 * 86400}), kv.put(keys.usd, String(microUsd + after), {expirationTtl: 2 * 86400}), kv.put(keys.neurons, String(Math.round(neurons + neuronsOf(usd))), {expirationTtl: 2 * 86400}),
    recordCost(env, access.who, request.headers.get('x-jp-action'), model, message.usage, usd, now),
    chargeCall(env, pro, after, request.headers.get('x-jp-action'), now),
    alertOnce(env, kv, day, microUsd, microUsd + after, fetcher),
    monthAlert(env, kv, month, globalMonth, globalMonth + after, fetcher),
    neuronAlert(env, kv, day, seen + neuronsOf(usd), allowance, fetcher),
  ]);
  ctx?.waitUntil ? ctx.waitUntil(work) : await work;
  if (body.stream) return new Response(asStream(message), {headers: {'content-type': 'text/event-stream', 'cache-control': 'no-cache'}});
  return Response.json(message);
}

// One Telegram line the day the global spend first crosses the alert line.
async function alertOnce(env, kv, day, before, after, fetcher) {
  const line = num(env.FREE_AI_ALERT_USD, LIMITS.alertUsd) * 1e6;
  if (before >= line || after < line || !env.BRAIN_BOT_TOKEN || !env.BRAIN_CHAT_ID || await kv.get(`freeai:alerted:${day}`)) return;
  await kv.put(`freeai:alerted:${day}`, '1', {expirationTtl: 2 * 86400});
  await fetcher(`https://api.telegram.org/bot${env.BRAIN_BOT_TOKEN}/sendMessage`, {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({chat_id: env.BRAIN_CHAT_ID, text: `⚠️ <b>Free AI</b> spend today passed $${line / 1e6} (stops at $${num(env.FREE_AI_STOP_USD, LIMITS.stopUsd)}). /admin/ai-cost has the steps.`, parse_mode: 'HTML'})}).catch(() => {});
}

// One Telegram line the month the global spend first crosses the month alert line ($40 of the $60 stop).
async function monthAlert(env, kv, month, before, after, fetcher) {
  const line = num(env.FREE_AI_MONTH_ALERT_USD, LIMITS.monthAlertUsd) * 1e6;
  if (before >= line || after < line || !env.BRAIN_BOT_TOKEN || !env.BRAIN_CHAT_ID || await kv.get(`freeai:monalerted:${month}`)) return;
  await kv.put(`freeai:monalerted:${month}`, '1', {expirationTtl: 40 * 86400});
  await fetcher(`https://api.telegram.org/bot${env.BRAIN_BOT_TOKEN}/sendMessage`, {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({chat_id: env.BRAIN_CHAT_ID, text: `⚠️ <b>Free AI</b> spend this month passed $${line / 1e6} (stops at $${num(env.FREE_AI_MONTH_STOP_USD, LIMITS.monthStopUsd)}). /admin/ai-cost has the installs.`, parse_mode: 'HTML'})}).catch(() => {});
}

const isJson = text => { try { JSON.parse(text); return true; } catch { return false; } };

// One Telegram line the first time today that 80% of the free plan's allowance is used (counted from the account's own usage when it can be read) (Free AI then stops at 100% until 00:00 UTC).
async function neuronAlert(env, kv, day, after, allowance, fetcher) {
  const line = allowance * 0.8;
  if (!Number.isFinite(allowance) || after < line || !env.BRAIN_BOT_TOKEN || !env.BRAIN_CHAT_ID || await kv.get(`freeai:neualert:${day}`)) return;
  await kv.put(`freeai:neualert:${day}`, '1', {expirationTtl: 2 * 86400});
  await fetcher(`https://api.telegram.org/bot${env.BRAIN_BOT_TOKEN}/sendMessage`, {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({chat_id: env.BRAIN_CHAT_ID, text: `⚠️ <b>Free AI</b> used 80% of today's free allowance (${Math.round(line)} of ${allowance} neurons). It stops at 100% until 00:00 UTC. /admin/ai-cost has the day.`, parse_mode: 'HTML'})}).catch(() => {});
}
