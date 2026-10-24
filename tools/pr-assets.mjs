// Publishes PR screenshots under a git tag (never a release: a release can become "Latest") and prints their raw URLs: node tools/pr-assets.mjs <tag> <file.png>...
import path from 'node:path';
import {publishFiles} from '../desktop/e2e/lib/evidence.mjs';

const [tag, ...files] = process.argv.slice(2);
if (!tag || !files.length) { console.error('usage: node tools/pr-assets.mjs <tag, e.g. pr-assets-<branch>> <file.png>...'); process.exit(2); }
const repo = process.env.GITHUB_REPOSITORY || 'GarryOne/jobadabra';
const out = publishFiles({repo, tag, message: `PR images ${tag}`, files: files.map(from => ({from, to: path.basename(from)})), remote: `https://github.com/${repo}.git`});
for (const url of Object.values(out)) console.log(url);   // the tag may carry a number when its name was taken
