// The Google sign-in (Gmail and Calendar, read-only) as the Python side saved it (src/sources/google.py KEYCHAIN),
// read from this Mac's Keychain so Always on can give the same sign-in to the user's GitHub repo. Never logged.
import {execFileSync} from 'node:child_process';

export const GOOGLE_KEYCHAIN = {GOOGLE_CLIENT_ID: 'job-pilotto.google.client-id', GOOGLE_CLIENT_SECRET: 'job-pilotto.google.client-secret',
  GOOGLE_REFRESH_TOKEN: 'job-pilotto.google.refresh-token'};

const keychain = service => {
  try { return execFileSync('security', ['find-generic-password', '-s', service, '-w'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim(); }
  catch { return ''; }
};

// All three or nothing (a partial sign-in can't be used). macOS only for now: elsewhere {} (connect Google there).
export function googleSecrets(read = keychain, platform = process.platform) {
  if (platform !== 'darwin' && read === keychain) return {};
  const values = Object.fromEntries(Object.entries(GOOGLE_KEYCHAIN).map(([name, service]) => [name, read(service)]));
  return Object.values(values).every(Boolean) ? values : {};
}
