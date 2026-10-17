// Ready to send, the night's AI (spec docs/superpowers/specs/2026-10-17-ready-to-send.md; owner, 17 Oct 2026: "Yes, add AI in phase 1", then "the user's own AI": the product holds NO AI key): the container answers the form's open questions with the same engine as the normal Apply,
// but never holds a key: each model call goes through here with the night token. Whose AI answers: the user's own key sealed in the batch (BYOK, the real Claude model), else the install's Free AI (its own per-install limits, src/free-ai.js).
// Only a Messages call on one fixed model goes on; its cost counts toward the night (so the $1 cap counts it); a refusal (a limit or the cap) answers 402 and marks the night "AI stopped" for the morning line. Guard: site/test/ready-ai.test.js.
import {freeAi} from './free-ai.js';
import {costUsd, SMALL} from './free-ai-models.js';
import {tokenFor} from './guard.js';
export const MODEL = 'claude-sonnet-5-5', MAX_TOKENS = 16000, MAX_BODY = 400 * 1024;
const PRICE = {input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5};   // $ per million tokens, as worker/src/extension.js prices the same model

// The micro-dollars one Messages response cost.
export const costMicro = (usage = {}) => Math.round((((usage.input_tokens || 0) * PRICE.input + (usage.output_tokens || 0) * PRICE.output
  + (usage.cache_read_input_tokens || 0) * PRICE.cacheRead + (usage.cache_creation_input_tokens || 0) * PRICE.cacheWrite)));

// Only these parts of a call go on: the model, the limit and the output format are the site's to set.
export function clean(given, env) {
  if (!Array.isArray(given?.messages) || !given.messages.length) return null;
  return {model: env.READY_AI_MODEL || MODEL, max_tokens: Math.min(Number(given.max_tokens) > 0 ? Number(given.max_tokens) : MAX_TOKENS, MAX_TOKENS), system: given.system, messages: given.messages,
    ...(given.output_config ? {output_config: given.output_config} : {})};
}

// row: the night's batch (already checked by its token); byok: the user's own key from the sealed batch, or ''. `charge(micro)` adds the cost to the night and says whether the cap was reached; `stopped()` marks the night's AI stopped.
// -> a Response.
export async function relay(request, env, row, charge, {byok = '', stopped = async () => {}, now = new Date()} = {}) {
  const refuse = async (status, error) => { await stopped(); return Response.json({ok: false, error}, {status}); };
  if (row.state === 'capped') return refuse(402, 'the night reached its cost cap');
  const text = await request.text();
  if (text.length > MAX_BODY) return Response.json({ok: false, error: 'too large'}, {status: 413});
  let params; try { params = clean(JSON.parse(text), env); } catch { params = null; }
  if (!params) return Response.json({ok: false, error: 'bad call'}, {status: 400});
  if (byok) {
    const reply = await (env.fetchFn || fetch)('https://api.anthropic.com/v1/messages', {method: 'POST', headers: {'content-type': 'application/json', 'x-api-key': byok, 'anthropic-version': '2023-06-01'}, body: JSON.stringify(params)});
    const body = await reply.text();
    let usage = null; try { usage = JSON.parse(body).usage; } catch { /* an error body: no cost */ }
    if (usage) await charge(costMicro(usage));
    if (reply.status === 401 || reply.status === 429) await stopped();   // the user's own key is wrong or out of limit: the morning says so
    return new Response(reply.ok ? body : JSON.stringify({ok: false, error: `model answered ${reply.status}`}), {status: reply.ok ? 200 : 502, headers: {'content-type': 'application/json'}});
  }
  // Free AI: the site mints this install's own token, so the app holds nothing for it; the install's Free AI limits (src/free-ai.js) apply and a refusal stops the night's AI.
  const key = `JPF1.${row.install}.${await tokenFor(row.install, env, 'ai')}`;
  const reply = await freeAi(new Request('https://x/api/ai/v1/messages', {method: 'POST', headers: {'x-api-key': key, 'content-type': 'application/json', 'x-jp-action': 'ready-night'}, body: JSON.stringify({...params, model: undefined})}), env, now, null, env.fetchFn || fetch);
  if (!reply.ok) return refuse(402, `Free AI: ${reply.status}`);
  const message = await reply.json();
  await charge(Math.round(costUsd(SMALL, message.usage) * 1e6));
  return Response.json(message);
}
