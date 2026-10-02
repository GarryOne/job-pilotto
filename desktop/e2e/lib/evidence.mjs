// Evidence for a finding (the screenshot of the page) is kept in the repository itself, at a tag, so an issue or a pull request can show it with a plain image link: GitHub has no
// API to attach an image to an issue. A TAG, not a branch: GitHub shows a "had recent pushes: Compare & pull request" banner on the Code page for every push to a branch (the
// first design pushed to `pr-assets` and the owner saw it all day). Each batch is a root commit under a tag of its own, so nothing is ever moved, rebased or forced.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const rawUrl = (repo, ref, file) => `https://raw.githubusercontent.com/${repo}/${ref}/${file.split('/').map(encodeURIComponent).join('/')}`;

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com', ...args],
  {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});

// Publishes the files as one commit under the tag `tag` (a number is added when that name is taken) -> {to: raw url} for the files that exist.
// remote: where to push (default: this repository with GH_TOKEN).
export function publishFiles({repo, files, message, tag, remote = `https://x-access-token:${process.env.GH_TOKEN || ''}@github.com/${repo}.git`}) {
  const present = files.filter(file => fs.existsSync(file.from));
  if (!present.length) return {};
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-'));
  try {
    git(work, 'init', '-q');
    git(work, 'remote', 'add', 'origin', remote);
    git(work, 'checkout', '-q', '--orphan', 'evidence');
    for (const {from, to} of present) {
      fs.mkdirSync(path.dirname(path.join(work, to)), {recursive: true});
      fs.copyFileSync(from, path.join(work, to));
    }
    git(work, 'add', '-A');
    git(work, 'commit', '-q', '-m', message);
    for (let n = 1; ; n++) {
      const name = n === 1 ? tag : `${tag}-${n}`;
      git(work, 'tag', name);
      try { git(work, 'push', '-q', 'origin', `refs/tags/${name}`); return Object.fromEntries(present.map(({to}) => [to, rawUrl(repo, name, to)])); }
      catch (error) { if (n >= 5) throw error; git(work, 'tag', '-d', name); }   // the name is taken (a run published twice): the next number, never a forced move
    }
  } finally { fs.rmSync(work, {recursive: true, force: true}); }
}
