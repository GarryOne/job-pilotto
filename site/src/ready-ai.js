// Ready to send, the night's AI (spec docs/superpowers/specs/2026-10-17-ready-to-send.md; owner, 17 Oct 2026: "Yes, add AI in phase 1"): the container answers the form's open questions with the same engine as the normal Apply,
// but never holds a key: each model call goes through here with the night token. The site keeps the key (READY_ANTHROPIC_KEY, owner-set, a spend-limited workspace), forwards only a Messages call on one fixed model,
// adds the call's cost to the night (so the $1 cap counts it), and refuses calls once the night is capped. Without the key it answers 503. Guard: site/test/ready-ai.test.js.
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

// row: the night's batch (already checked by its token). -> a Response; `charge(micro)` adds the cost to the night and says whether the cap was reached.
export async function relay(request, env, row, charge) {
  if (!env.READY_ANTHROPIC_KEY) return Response.json({ok: false, error: 'not wired: no AI key for the night'}, {status: 503});
  if (row.state === 'capped') return Response.json({ok: false, error: 'the night reached its cost cap'}, {status: 402});
  const text = await request.text();
  if (text.length > MAX_BODY) return Response.json({ok: false, error: 'too large'}, {status: 413});
  let params; try { params = clean(JSON.parse(text), env); } catch { params = null; }
  if (!params) return Response.json({ok: false, error: 'bad call'}, {status: 400});
  const reply = await (env.fetchFn || fetch)('https://api.anthropic.com/v1/messages', {method: 'POST', headers: {'content-type': 'application/json', 'x-api-key': env.READY_ANTHROPIC_KEY, 'anthropic-version': '2023-06-01'}, body: JSON.stringify(params)});
  const body = await reply.text();
  let usage = null; try { usage = JSON.parse(body).usage; } catch { /* an error body: no cost */ }
  if (usage) await charge(costMicro(usage));
  return new Response(reply.ok ? body : JSON.stringify({ok: false, error: `model answered ${reply.status}`}), {status: reply.ok ? 200 : 502, headers: {'content-type': 'application/json'}});
}
