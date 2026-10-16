// Free AI (owner, 16 Oct 2026): /api/ai/* answers the app's Anthropic-shaped calls with an open model on Workers AI (env.AI), for every install, no key.
// The app's "API key" is JPF1.<install>.<token> (a token minted by /api/install-token with purpose "ai"), so both SDKs carry it unchanged.
// Fair use per install (minute, day), a global daily line with a Telegram alert, and a kill switch (FREE_AI=off). Nothing is stored: not the request, not the answer.
import {record as recordCost} from './aicost.js';
import {authorize, digestOf} from './guard.js';
import {verifyLicense} from './license.js';
import {asStream, fromWorkersAi, toWorkersAi, Unsupported} from './free-ai-translate.js';
import {costUsd, modelFor} from './free-ai-models.js';

// Per install: 30 calls a minute, 300 calls and 1.5M tokens a day. Global: alert at $3 a day, stop at $10 a day (env FREE_AI_ALERT_USD / FREE_AI_STOP_USD).
export const LIMITS = {perMinute: 30, perDay: 300, tokensPerDay: 1_500_000, alertUsd: 3, stopUsd: 10};

const error = (status, message, type = 'api_error') => Response.json({type: 'error', error: {type, message}}, {status});
const num = (value, fallback) => (Number(value) > 0 ? Number(value) : fallback);
const count = async (kv, key) => Number(await kv.get(key)) || 0;

export const parseKey = key => { const [tag, install, token] = String(key || '').split('.'); return tag === 'JPF1' && install && token ? {install, token} : null; };

// Apps from before Free AI still send their founder/friend key (JP1.…): it works the same until they update.
async function who(key, env) {
  const given = parseKey(key);
  if (given) { const access = await authorize(env, given.install, given.token, 'ai'); return access.ok ? access : null; }
  const license = String(key || '').startsWith('JP1.') && await verifyLicense(key, env.LICENSE_PUBLIC_KEY);
  return license ? {ok: true, who: await digestOf(`license:${license.id}`)} : null;
}

export async function freeAi(request, env, now = new Date(), ctx = null, fetcher = fetch) {
  const path = new URL(request.url).pathname.replace(/^\/api\/ai/, '');
  if (env.FREE_AI === 'off') return error(503, 'Free AI is paused right now. You can add your own key in Settings → AI engine.');
  if (!env.AI || !env.WAITLIST) return error(503, 'Free AI is not available right now.');
  const access = await who(request.headers.get('x-api-key'), env);
  if (!access) return error(401, 'Free AI needs this install\'s token. Restart Job Pilotto and try again.', 'authentication_error');
  if (path === '/v1/models' && request.method === 'GET') return Response.json({data: [], has_more: false});   // key checks
  if (path !== '/v1/messages' || request.method !== 'POST') return error(404, 'Not available with Free AI.', 'not_found_error');

  const kv = env.WAITLIST, day = now.toISOString().slice(0, 10), minute = now.toISOString().slice(0, 16);
  const keys = {minute: `freeai:min:${access.who}:${minute}`, day: `freeai:day:${access.who}:${day}`, tokens: `freeai:tok:${access.who}:${day}`, usd: `freeai:usd:${day}`};
  const [perMinute, perDay, tokens, microUsd] = await Promise.all(Object.values(keys).map(key => count(kv, key)));
  if (microUsd >= num(env.FREE_AI_STOP_USD, LIMITS.stopUsd) * 1e6) return error(503, 'Free AI is busy today. Try again tomorrow, or add your own key in Settings → AI engine.');
  if (perMinute >= LIMITS.perMinute) return error(429, 'Free AI: too many requests in a minute. Job Pilotto will retry.', 'rate_limit_error');
  if (perDay >= LIMITS.perDay || tokens >= LIMITS.tokensPerDay) return error(429, 'You reached today\'s Free AI use. It resets tomorrow, or add your own key in Settings → AI engine.', 'rate_limit_error');

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
    if (caught instanceof Unsupported) return error(422, `${caught.message} Add your own key in Settings → AI engine for this step.`, 'invalid_request_error');
    return error(502, 'Free AI could not answer just now.');
  }
  const message = fromWorkersAi(result, model);
  const used = message.usage.input_tokens + message.usage.output_tokens, usd = costUsd(model, message.usage);
  const after = Math.round(usd * 1e6);
  const work = Promise.all([
    kv.put(keys.minute, String(perMinute + 1), {expirationTtl: 120}), kv.put(keys.day, String(perDay + 1), {expirationTtl: 2 * 86400}),
    kv.put(keys.tokens, String(tokens + used), {expirationTtl: 2 * 86400}), kv.put(keys.usd, String(microUsd + after), {expirationTtl: 2 * 86400}),
    recordCost(env, access.who, request.headers.get('x-jp-action'), model, message.usage, usd, now),
    alertOnce(env, kv, day, microUsd, microUsd + after, fetcher),
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

const isJson = text => { try { JSON.parse(text); return true; } catch { return false; } };
