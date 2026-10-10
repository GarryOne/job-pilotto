// The free AI credit for invited testers ($1, lib site/src/trial.js on the website): instead of their own Anthropic
// key, the app sends its owner-signed license key (JP1.…) to our website, which forwards to Anthropic with the
// owner's trial key. Both SDKs (the app's JS and the Python pipeline) follow ANTHROPIC_BASE_URL, so switching is
// one variable. Own key saved later → back to Anthropic directly (settings.aiTrial off).
export const TRIAL_BASE = 'https://www.jobpilotto.top/api/ai';

export const isTrialKey = key => String(key || '').startsWith('JP1.');

// Point this process's Anthropic SDK at the trial endpoint, or back at Anthropic.
export function apply(settings, env = process.env) {
  if (settings?.aiTrial) env.ANTHROPIC_BASE_URL = TRIAL_BASE;
  else delete env.ANTHROPIC_BASE_URL;
  // The end-to-end journey (desktop/e2e) sends the app's own AI calls through its test proxy, as lib/pipeline.js does for the engine.
  if (env.JOB_PILOTTO_E2E && env.JOB_PILOTTO_E2E_AI_BASE_URL) env.ANTHROPIC_BASE_URL = env.JOB_PILOTTO_E2E_AI_BASE_URL;
  // The same for the OpenAI SDK (it follows OPENAI_BASE_URL): the e2e meters and replays the app's OpenAI calls too. Never set for a user.
  if (env.JOB_PILOTTO_E2E && env.JOB_PILOTTO_E2E_OPENAI_BASE_URL) env.OPENAI_BASE_URL = env.JOB_PILOTTO_E2E_OPENAI_BASE_URL;
}

// Turn the credit on with the app's license key. -> {ok, error?}
export function start(storage, licenseState, env = process.env) {
  const state = licenseState();
  const key = storage.settings().license?.key;
  if (!state.licensed || !key) return {ok: false, error: 'The free credit is for invited testers: paste your founder or friend key first (Settings → License).'};
  storage.setSecret('ANTHROPIC_API_KEY', key);
  storage.saveSettings({aiTrial: true});
  apply(storage.settings(), env);
  return {ok: true};
}

// Own key saved: stop using the credit.
export function stop(storage, env = process.env) {
  if (!storage.settings().aiTrial) return;
  storage.saveSettings({aiTrial: false});
  apply(storage.settings(), env);
}

// How much of the credit is used: {usedUsd, limitUsd, open} or null.
export async function credit(storage, fetcher = globalThis.fetch) {
  if (!storage.settings().aiTrial) return null;
  try {
    const response = await fetcher(`${TRIAL_BASE}/credit`, {headers: {'x-api-key': storage.secret('ANTHROPIC_API_KEY') || ''}});
    return response.ok ? await response.json() : null;
  } catch { return null; }
}
