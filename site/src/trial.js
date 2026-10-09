// The free AI credit for invited testers (Stage 1): /api/ai/* forwards Anthropic API calls with the owner's trial key
// (Worker secret ANTHROPIC_TRIAL_KEY, its own Anthropic workspace with a spend limit). The app points its Anthropic
// SDKs here (ANTHROPIC_BASE_URL) and sends the owner-signed license key (JP1.…) as its API key. Only license
// holders: install ids can be faked, signed keys can't. $1 per key and a monthly total cap (wrangler.toml vars),
// counted in KV from each response's token usage. Nothing is stored: not the request, not the answer.
import {record as recordCost} from './aicost.js';
import {verifyLicense} from './license.js';

const ANTHROPIC = 'https://api.anthropic.com';
// USD per million tokens (input, output), Anthropic list prices; unknown models are charged like the priciest known.
const PRICES = {'claude-haiku-5-5': [0.1, 0.5], 'claude-haiku-4-5': [1, 5], 'claude-sonnet-5': [2, 10], 'claude-sonnet-5-5': [2, 10], 'claude-opus-5-5': [4, 20]};
// A model not in the list is charged like a $15 / $75 model: dearer than any model the trial offers, so an unknown name can never dodge the monthly cap.
const UNKNOWN_MODEL = [15, 75];
const price = model => PRICES[Object.keys(PRICES).find(name => String(model || '').startsWith(name))] || UNKNOWN_MODEL;

export function costUsd(model, usage = {}) {
  const [input, output] = price(model);
  const read = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) * 1.25 + (usage.cache_read_input_tokens || 0) * 0.1;
  return (read * input + (usage.output_tokens || 0) * output) / 1e6;
}

const error = (status, message, type = 'permission_error') => Response.json({type: 'error', error: {type, message}}, {status});
const month = now => now.toISOString().slice(0, 7);
const cents = async (kv, key) => Number(await kv.get(key)) || 0;

async function credit(env, id, now) {
  const perKey = Number(env.TRIAL_PER_KEY_USD || 1) * 100, perMonth = Number(env.TRIAL_MONTH_USD || 20) * 100;
  const [used, total] = await Promise.all([cents(env.WAITLIST, `trial:key:${id}`), cents(env.WAITLIST, `trial:month:${month(now)}`)]);
  return {used, total, perKey, perMonth, left: Math.max(0, perKey - used), open: used < perKey && total < perMonth};
}

export async function trial(request, env, fetcher = fetch, now = new Date()) {
  const path = new URL(request.url).pathname.replace(/^\/api\/ai/, '');
  if (!env.ANTHROPIC_TRIAL_KEY || !env.WAITLIST) return error(503, 'The free AI credit is not available right now.', 'api_error');
  const license = await verifyLicense(request.headers.get('x-api-key') || '', env.LICENSE_PUBLIC_KEY);
  if (!license) return error(401, 'The free AI credit needs your Job Pilotto founder or friend key.', 'authentication_error');
  const state = await credit(env, license.id, now);
  if (path === '/credit') return Response.json({usedUsd: state.used / 100, limitUsd: state.perKey / 100, open: state.open});
  if (path === '/v1/models' && request.method === 'GET') return Response.json({data: [], has_more: false});  // key checks
  if (path !== '/v1/messages' || request.method !== 'POST') return error(404, 'Not available with the free credit.', 'not_found_error');
  if (!state.open) return error(402, state.used >= state.perKey
    ? 'Your free AI credit ($1) is used up. Add your own Anthropic key in Settings → Anthropic to continue.'
    : 'The free AI credit is paused for this month. Add your own Anthropic key in Settings → Anthropic to continue.');
  const body = await request.text();
  const headers = {'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_TRIAL_KEY,
    'anthropic-version': request.headers.get('anthropic-version') || '2023-06-01'};
  if (request.headers.get('anthropic-beta')) headers['anthropic-beta'] = request.headers.get('anthropic-beta');
  const response = await fetcher(`${ANTHROPIC}/v1/messages`, {method: 'POST', headers, body});
  const charge = (model, usage) => spend(env, license.id, state, request.headers.get('x-jp-action'), model, usage, now);
  // A streamed answer (the strategy draft's progress bar) passes through as it arrives; its cost comes from the stream's own usage events.
  if (response.ok && response.body && /^text\/event-stream/.test(response.headers.get('content-type') || '')) {
    return new Response(response.body.pipeThrough(metered(charge)), {status: response.status,
      headers: {'content-type': 'text/event-stream', 'cache-control': 'no-cache'}});
  }
  const text = await response.text();
  if (response.ok) {
    let data = {};
    try { data = JSON.parse(text); } catch {}
    await charge(data.model, data.usage);
  }
  return new Response(text, {status: response.status, headers: {'content-type': 'application/json'}});
}

// Counts one answered call against the license's credit and the month's cap.
async function spend(env, id, state, action, model, usage, now) {
  const usd = costUsd(model, usage), spent = Math.ceil(usd * 100 * 100) / 100;  // cents, rounded up to 1/100 cent
  // What each AI step costs us (src/aicost.js): counts and money per step, the license holder only as a digest.
  await recordCost(env, id, action, model, usage, usd, now);
  await Promise.all([env.WAITLIST.put(`trial:key:${id}`, String(state.used + spent)),
    env.WAITLIST.put(`trial:month:${month(now)}`, String(state.total + spent), {expirationTtl: 60 * 86400})]);
}

// Passes server-sent events through unchanged while reading the model and token usage from message_start and message_delta;
// charges once the stream ends. A stream cut before any usage is still charged for what message_start reported.
export function metered(charge) {
  const decoder = new TextDecoder();
  let buffer = '', model, usage = {};
  const read = line => {
    if (!line.startsWith('data:')) return;
    let event;
    try { event = JSON.parse(line.slice(5)); } catch { return; }
    if (event.type === 'message_start') { model = event.message?.model; usage = {...event.message?.usage}; }
    if (event.type === 'message_delta' && event.usage) usage = {...usage, ...Object.fromEntries(Object.entries(event.usage).filter(([, v]) => v != null))};
  };
  return new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      buffer += decoder.decode(chunk, {stream: true});
      const lines = buffer.split('\n');
      buffer = lines.pop();
      lines.forEach(read);
    },
    async flush() {
      read(buffer + decoder.decode());
      if (model || Object.keys(usage).length) await charge(model, usage);
    },
  });
}
