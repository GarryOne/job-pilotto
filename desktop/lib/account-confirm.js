// After the extension pressed a sign-up page's button (owner, 8 Oct 2026): find the confirmation mail the site sent to the address the account was made with
// (Gmail, read-only; the AI picks the confirm link or code among the mail's own, in any language: src/sources/google.py verify), open its link in the extension's
// Chrome (armed, so the flow goes on from the page it lands on) and mark the account confirmed. A code, not a link, is left to the person (shown in the session).
// Never logs the address, the link or the code. Guard: test/account-confirm.test.js.
import {log as appLog} from './log.js';

export function parseVerify(stdout) {
  try { const found = JSON.parse(String(stdout || '').trim().split('\n').pop()); return found && !found.error ? found : null; } catch { return null; }
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
