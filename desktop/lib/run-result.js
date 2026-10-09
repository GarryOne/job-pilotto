// The engine's result file (src/run_result.py): one object per run, instead of the last stdout line.
import fs from 'node:fs';

export const MAIL_SKIPPED = {
  spend: 'not checked: the Anthropic API spend limit was reached',
  plan: 'not checked: your Claude usage window is exhausted; it runs again later',
  claude: 'not checked: Claude Code is not ready (Settings → AI)',
  google: 'not checked: the Google sign-in expired (Settings → Gmail and Calendar)',
};

// null when the file is missing or not this contract. A command that crashed before Python started has no file.
export function readResult(file) {
  try {
    const body = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!body || body.v !== 1 || typeof body.run_id !== 'string' || !body.run_id) return null;
    return body;
  } catch { return null; }
}

// Why a Gmail check read nothing, from the result when the engine wrote one, else from the sentences it still prints
// (a GitHub log from before this contract, or a run whose result file was lost).
// A digest the Telegram bot could not deliver (#298, 5 Oct 2026: the run was Failed and "1 new job", and nothing said the digest never reached the person). From the log's lines.
export const DELIVERY_PROBLEMS = [
  [/bot was blocked by the user|Forbidden: bot was blocked/i, 'not delivered: Telegram blocked the bot (open the chat with it and press Start; Settings → Telegram)'],
  [/chat not found/i, 'not delivered: Telegram cannot find the chat (check the chat id in Settings → Telegram)'],
  [/Telegram[^\n]*\b(?:Unauthorized|401)\b|\b(?:Unauthorized|401)\b[^\n]*Telegram/i, 'not delivered: Telegram refused the bot token (Settings → Telegram)'],
];
export function deliveryProblem(lines) {
  const text = (Array.isArray(lines) ? lines : [String(lines || '')]).join('\n');
  return DELIVERY_PROBLEMS.find(([pattern]) => pattern.test(text))?.[1] || null;
}

// The same reasons for an OpenAI-family engine (src/ai/providers: openai_api, codex_cli).
export const MAIL_SKIPPED_OPENAI = {
  spend: 'not checked: the OpenAI API credit or spend limit was reached',
  plan: 'not checked: your ChatGPT plan\'s Codex limit is reached; it runs again later',
  claude: 'not checked: Codex is not ready (Settings → AI)',
  google: MAIL_SKIPPED.google,
};

export function mailProblem(stdout, result, family = 'claude') {
  if (family === 'openai' && MAIL_SKIPPED_OPENAI[result?.mail?.skipped]) return MAIL_SKIPPED_OPENAI[result.mail.skipped];
  const code = result?.mail?.skipped;
  if (code && MAIL_SKIPPED[code]) return MAIL_SKIPPED[code];
  if (/^Mail check skipped: the Anthropic API spend limit/m.test(stdout || '')) return MAIL_SKIPPED.spend;
  if (/^Mail check skipped: Claude Code: your Claude usage window/m.test(stdout || '')) return MAIL_SKIPPED.plan;
  if (/^Mail check skipped: Claude Code (?:is not signed in|was not found)/m.test(stdout || '')) return MAIL_SKIPPED.claude;
  // The OpenAI family's own lines (src/ai/providers: codex_cli, openai_api), whatever engine the app thinks is chosen.
  if (/^Mail check skipped: Codex: your ChatGPT plan's usage limit/m.test(stdout || '')) return MAIL_SKIPPED_OPENAI.plan;
  if (/^Mail check skipped: Codex (?:is not signed in|was not found)/m.test(stdout || '')) return MAIL_SKIPPED_OPENAI.claude;
  if (/^Mail check skipped: OpenAI: your API account has no credit left/m.test(stdout || '')) return MAIL_SKIPPED_OPENAI.spend;
  if (/^Mail check skipped: OpenAI refused the API key/m.test(stdout || '')) return MAIL_SKIPPED_OPENAI.claude;
  if (/The Google sign-in for Gmail and Calendar has expired/.test(stdout || '')) return MAIL_SKIPPED.google;
  return null;
}
