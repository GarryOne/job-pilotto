// Running from source (npm start / electron .) must never look like the installed app: a "DEV" badge on the Dock
// icon and "DEV · <branch>" in the window title, outside the app's own design. Packaged: nothing.
import {execFileSync} from 'node:child_process';

export function branch(cwd, run = execFileSync) {
  try { return run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim(); }
  catch { return ''; }
}

export const title = (dev, gitBranch = '') => (dev ? `Job Pilotto · DEV${gitBranch ? ` · ${gitBranch}` : ''}` : 'Job Pilotto');
