// Fails a CI suite at once, with the key's name, when the AI test key is refused (401/403) or a model a suite asks for is refused: free calls (the model list, then
// count_tokens per model: no tokens are produced, nothing is billed). Before it, a refusal showed only as a bare "400" or "AI limit reached" in the engine log and a step that
// expected an AI answer (17 Oct 2026, strategy). Guarded by test/key-check.test.mjs.
const CHECKS = {
  openai: {secret: 'E2E_OPENAI_KEY', url: 'https://api.openai.com/v1/models', headers: key => ({authorization: `Bearer ${key}`})},
  api: {secret: 'E2E_ANTHROPIC_KEY', url: 'https://api.anthropic.com/v1/models', headers: key => ({'x-api-key': key, 'anthropic-version': '2023-06-01'})},
};
// The Claude models the app and the suites call (src/ai/models.py SMALL/MAIN/BIG; test/key-check.test.mjs keeps this list equal to that file).
export const CLAUDE_MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'];
const COUNT_TOKENS = 'https://api.anthropic.com/v1/messages/count_tokens';

const say = async response => { try { return String((await response.json())?.error?.message || '').replace(/\s+/g, ' ').replace(/sk-[\w-]{6,}|Bearer\s+\S+|\b[A-Za-z0-9_-]{32,}\b/g, '…').slice(0, 160); } catch { return ''; } };

// An unreachable network is not a verdict on the key: only the provider's own 401/403, or a 400/404 about a model, stops the suite.
export async function checkKeyAccepted({engine, key, fetchImpl = fetch}) {
  const check = CHECKS[engine];
  if (!check || !key) return;
  const ask = async (url, options = {}) => { try { return await fetchImpl(url, {...options, headers: {...check.headers(key), ...options.headers}, signal: AbortSignal.timeout(15000)}); } catch { return null; } };
  const listed = await ask(check.url);
  if (!listed) return;
  if (listed.status === 401 || listed.status === 403) throw new Error(`${check.secret} refused (${listed.status}): the key is revoked, from the wrong project or without access; replace the secret before the next run`);
  if (engine !== 'api') return;
  for (const model of CLAUDE_MODELS) {
    const counted = await ask(COUNT_TOKENS, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({model, messages: [{role: 'user', content: 'ok'}]})});
    if (counted && (counted.status === 400 || counted.status === 404)) throw new Error(`${check.secret}: the API refused model ${model} (${counted.status}) before any suite ran: "${await say(counted)}"`);
  }
}
export const CHECKED_ENGINES = Object.keys(CHECKS);
