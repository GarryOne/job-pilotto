// Fails a CI suite at once, with the key's name, when the AI test key is refused (401/403): a free GET of the model list, no AI call, no spend.
// Before it, a refused key showed only as "AI limit reached" in the engine log and a step that expected an AI answer (17 Oct 2026, strategy). Guarded by test/key-check.test.mjs.
const CHECKS = {
  openai: {secret: 'E2E_OPENAI_KEY', url: 'https://api.openai.com/v1/models', headers: key => ({authorization: `Bearer ${key}`})},
  api: {secret: 'E2E_ANTHROPIC_KEY', url: 'https://api.anthropic.com/v1/models', headers: key => ({'x-api-key': key, 'anthropic-version': '2023-06-01'})},
};

// An unreachable network is not a verdict on the key: only the provider's own 401/403 stops the suite.
export async function checkKeyAccepted({engine, key, fetchImpl = fetch}) {
  const check = CHECKS[engine];
  if (!check || !key) return;
  let status = 0;
  try { status = (await fetchImpl(check.url, {headers: check.headers(key), signal: AbortSignal.timeout(15000)})).status; } catch { return; }
  if (status === 401 || status === 403) throw new Error(`${check.secret} refused (${status}): the key is revoked, from the wrong project or without access; replace the secret before the next run`);
}
export const CHECKED_ENGINES = Object.keys(CHECKS);
