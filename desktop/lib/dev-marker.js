// Running from source (npm start / electron .) must never look like the installed app: a "DEV" badge on the Dock
// icon, "DEV · <branch>" in the window title, and a DEV tag in the sidebar (renderer: about.dev). Packaged: nothing.
// A live-test twin (lib/twin.js) says TWIN in all three instead, so the owner's DEV window and the twin are told apart at a glance.
import {execFileSync} from 'node:child_process';
import {isTwin} from './twin.js';

export const mark = (env = process.env) => (isTwin(env) ? 'TWIN' : 'DEV');

export function branch(cwd, run = execFileSync) {
  try { return run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim(); }
  catch { return ''; }
}

export const title = (dev, gitBranch = '', word = mark()) => (dev || word === 'TWIN' ? `Job Pilotto · ${word}${gitBranch ? ` · ${gitBranch}` : ''}` : 'Job Pilotto');
