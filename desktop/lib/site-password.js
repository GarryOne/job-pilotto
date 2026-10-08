// The user's one job-site password (src/ai/passwords.py makes it, Keychain item job-pilotto.sites.password): Settings shows it,
// so they can sign in by hand too. Read straight from the Keychain, never through an engine run: a run's output goes to the log.
import {execFileSync} from 'node:child_process';

export const SERVICE = 'job-pilotto.sites.password';

// → the password, or null (none yet, or not a Mac: the Credential Manager is read by the engine only).
export function read(platform = process.platform, exec = execFileSync) {
  if (platform !== 'darwin') return null;
  try { return exec('security', ['find-generic-password', '-a', 'job-pilotto', '-s', SERVICE, '-w'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim() || null; } catch { return null; }
}
