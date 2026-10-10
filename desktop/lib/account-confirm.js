// After the extension pressed a sign-up page's button (owner, 8 Oct 2026): find the confirmation mail the site sent to the address the account was made with
// (Gmail, read-only; the AI picks the confirm link or code among the mail's own, in any language: src/sources/google.py verify), open its link in the extension's
// Chrome (armed, so the flow goes on from the page it lands on) and mark the account confirmed. A code, not a link, is left to the person (shown in the session).
// Never logs the address, the link or the code. Guard: test/account-confirm.test.js.
import {log as appLog} from './log.js';

export function parseVerify(stdout) {
  try { const found = JSON.parse(String(stdout || '').trim().split('\n').pop()); return found && !found.error ? found : null; } catch { return null; }
}

// The code in the confirmation mail, for the extension to type (owner, 10 Oct 2026). -> the code, or ''. Never logged: the log says only whether one was found.
export async function codeFromMail({host, email, run, minutes = 30, wait = 90, log = appLog}) {
  if (!host || !email) return '';
  const {code, stdout} = await run(['src.sources.google', 'verify', '--to', email, '--minutes', String(minutes), '--wait', String(wait)]);
  const found = code === 0 ? parseVerify(stdout) : null;
  const value = String(found?.code || '').trim();
  log('extension', `account: ${value ? 'the code was read from the mail' : 'no code in the mail'}`, {host: String(host).slice(0, 120), exit: code});
  return value;
}

// The app's answer to the extension's "the page asks for a code" (lib/ext-server-handlers.js): only in "Do it for me", only for an email we have, only a code the mail holds.
export async function accountCodeAnswer({mode, host, email, read}) {
  if (mode !== 'full') return {ok: false, why: 'the person types the code'};
  if (!host || !email) return {ok: false, why: 'no email'};
  const code = await read({host, email});
  return code ? {ok: true, code} : {ok: false, why: 'no code in the mail'};
}

// -> 'confirmed' | 'code' | 'none'. run(args) -> {code, stdout}; open(url) opens it in the extension's Chrome; mark() records the account as confirmed.
export async function confirmAccount({host, email, run, open, mark, minutes = 15, wait = 240, log = appLog}) {
  if (!host || !email) return 'none';
  const {code, stdout} = await run(['src.sources.google', 'verify', '--to', email, '--minutes', String(minutes), '--wait', String(wait)]);
  const found = code === 0 ? parseVerify(stdout) : null;
  if (!found) { log('extension', 'account: no confirmation mail found', {host: String(host).slice(0, 120), code}); return 'none'; }
  const link = (found.links || []).find(item => /^https:\/\//i.test(item));
  if (link) {
    open(link);
    mark();
    log('extension', 'account confirmed: the mail\'s link was opened', {host: String(host).slice(0, 120), links: found.links.length});
    return 'confirmed';
  }
  log('extension', 'account: the mail has a code, not a link: left to the person', {host: String(host).slice(0, 120), code: !!found.code});
  return 'code';
}
