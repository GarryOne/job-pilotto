// The harness's reader of the test inboxes (test-account-*@jobpilotto.top, site/src/test-mail.js): waits for a mail and returns its verification link or code.
// The key: the Keychain (job-pilotto.site.api_key) on a Mac, JP_SITE_API_KEY (a GitHub secret) on CI. Only test-account-* addresses are ever asked for; no value is printed.
// Guard: e2e/test/test-mail.test.mjs.
import {execFileSync} from 'node:child_process';

const SITE = 'https://www.jobpilotto.top';
export const isTestInbox = address => /^test-account-[a-z0-9][a-z0-9._+-]{0,60}@jobpilotto\.top$/i.test(String(address || ''));

export function siteKey(env = process.env, exec = execFileSync) {
  if (env.JP_SITE_API_KEY) return env.JP_SITE_API_KEY;
  try { return exec('security', ['find-generic-password', '-s', 'job-pilotto.site.api_key', '-w'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim(); } catch { return ''; }
}

// The newest mail to `to` received at or after `since` (an ISO time or Date; default: now), polling up to waitMs. -> {received_at, from, subject, body, links, codes, link, code} or null.
// `link`/`code` are the first link / code, `match` (a RegExp on a link) picks a specific link, e.g. /verify/.
export async function latestMail(to, {since = new Date(), waitMs = 0, every = 3000, match, key = siteKey(), fetchImpl = fetch, base = SITE, sleep = ms => new Promise(r => setTimeout(r, ms))} = {}) {
  if (!isTestInbox(to)) throw new Error('latestMail: only test-account-*@jobpilotto.top inboxes are read');
  if (!key) throw new Error('latestMail: no site key (Keychain job-pilotto.site.api_key or JP_SITE_API_KEY)');
  const from = new Date(since).toISOString(), deadline = Date.now() + waitMs;
  for (;;) {
    const response = await fetchImpl(`${base}/admin/test-mail?to=${encodeURIComponent(to.toLowerCase())}&since=${encodeURIComponent(from)}`, {headers: {Authorization: `Bearer ${key}`}});
    if (!response.ok) throw new Error(`latestMail: the site answered ${response.status}`);
    const {mails = []} = await response.json();
    const mail = mails[0];
    if (mail) return {...mail, link: (match ? mail.links.find(l => match.test(l)) : mail.links[0]) || '', code: mail.codes[0] || ''};
    if (Date.now() >= deadline) return null;
    await sleep(every);
  }
}
