// Settings → Credentials: the accounts Claude made on job sites (src/ai/passwords.py: Keychain item job-pilotto.<site>.password,
// with "email=… job=…" as its comment). The list comes from the Keychain's item attributes, never its secrets; a password is read
// only when you press Show or Copy. Mac only: Windows' Credential Manager is read by the engine.
import {execFileSync} from 'node:child_process';

const ITEM = /^job-pilotto\.(.+)\.password$/;

// `security dump-keychain` (attributes only) → [{host, email, job, created}], newest first. The job-site password itself
// (job-pilotto.sites.password) is not a site.
export function parseDump(text) {
  const rows = [];
  for (const block of String(text || '').split(/^keychain: /m)) {
    if (!/^class: "genp"/m.test(block)) continue;
    const attr = name => (block.match(new RegExp(`"${name}"<[a-z]+>="([^"]*)"`)) || [])[1] || '';
    const host = (attr('svce').match(ITEM) || [])[1];
    if (!host || !host.includes('.') || attr('acct') !== 'job-pilotto') continue;   // a site's host name: not 'sites' (the shared one) nor 'mac-sign'
    const note = attr('icmt'), stamp = (block.match(/"cdat"<timedate>=0x[0-9A-F]+\s+"(\d{14})Z/) || [])[1] || '';
    rows.push({host, email: (note.match(/(?:^|\s)email=(\S+)/) || [])[1] || '', job: (note.match(/(?:^|\s)job=(\S+)/) || [])[1] || '',
      created: stamp ? `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(8, 10)}:${stamp.slice(10, 12)}:${stamp.slice(12, 14)}Z` : ''});
  }
  return rows.sort((a, b) => b.created.localeCompare(a.created));
}

export function list(platform = process.platform, exec = execFileSync) {
  if (platform !== 'darwin') return {ok: false, rows: [], error: 'Credentials are listed on a Mac only for now.'};
  try { return {ok: true, rows: parseDump(exec('security', ['dump-keychain'], {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore']}))}; }
  catch { return {ok: false, rows: [], error: 'The Keychain could not be read.'}; }
}

// One site's password, when you ask for it. host comes from the list: only a plain host name is read.
export function reveal(host, platform = process.platform, exec = execFileSync) {
  if (platform !== 'darwin' || !/^[a-z0-9.-]{1,253}$/i.test(String(host || ''))) return null;
  try { return exec('security', ['find-generic-password', '-a', 'job-pilotto', '-s', `job-pilotto.${host}.password`, '-w'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim() || null; }
  catch { return null; }
}
