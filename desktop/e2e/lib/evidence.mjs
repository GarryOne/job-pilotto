// Evidence for a finding (the screenshot of the page) lives in the repository, on the `pr-assets` branch (the one UI pull requests already use for their before/after pictures),
// so an issue or a pull request shows it with a plain image link: GitHub has no API to attach an image to an issue.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const BRANCH = 'pr-assets';

export const rawUrl = (repo, branch, file) => `https://raw.githubusercontent.com/${repo}/${branch}/${file.split('/').map(encodeURIComponent).join('/')}`;

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com', ...args],
  {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});

// Adds the files to the branch in one commit and pushes it (a normal push, retried against a concurrent one). -> {to: raw url} for the files that exist.
// remote: where to push (default: this repository with GH_TOKEN); the branch is created when it does not exist.
export function publishFiles({repo, files, message, remote = `https://x-access-token:${process.env.GH_TOKEN || ''}@github.com/${repo}.git`, branch = BRANCH}) {
  const present = files.filter(file => fs.existsSync(file.from));
  if (!present.length) return {};
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-'));
  try {
    for (let attempt = 0; ; attempt++) {
      fs.rmSync(work, {recursive: true, force: true});
      fs.mkdirSync(work, {recursive: true});
      git(work, 'init', '-q');
      git(work, 'remote', 'add', 'origin', remote);
      let exists = true;
      try { git(work, 'fetch', '-q', '--depth', '1', 'origin', branch); } catch { exists = false; }
      if (exists) git(work, 'checkout', '-q', '-B', branch, 'FETCH_HEAD'); else git(work, 'checkout', '-q', '--orphan', branch);
      for (const {from, to} of present) {
        fs.mkdirSync(path.dirname(path.join(work, to)), {recursive: true});
        fs.copyFileSync(from, path.join(work, to));
      }
      git(work, 'add', '-A');
      git(work, 'commit', '-q', '-m', message);
      try { git(work, 'push', '-q', 'origin', branch); break; } catch (error) { if (attempt >= 3) throw error; }   // someone pushed first: fetch and try again
    }
  } finally { fs.rmSync(work, {recursive: true, force: true}); }
  return Object.fromEntries(present.map(({to}) => [to, rawUrl(repo, branch, to)]));
}
