// Running from source (npm start / electron .) must never look like the installed app: a "DEV" badge on the Dock
// icon, "DEV · <branch>" in the window title, and a DEV tag in the sidebar (renderer: about.dev). Packaged: nothing.
import {execFileSync} from 'node:child_process';

export function branch(cwd, run = execFileSync) {
  try { return run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim(); }
  catch { return ''; }
}

export const title = (dev, gitBranch = '') => (dev ? `Job Pilotto · DEV${gitBranch ? ` · ${gitBranch}` : ''}` : 'Job Pilotto');
