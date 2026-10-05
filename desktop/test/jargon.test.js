// What a person who is not in IT reads in the app: no IT-only example or label in the words the renderer shows (5 Oct 2026, after a
// nurse's first run showed "N SRE roles", "default SRE settings" and a Kubernetes tip). Comments are not read; the allow-list says why
// each remaining use is fine. A new IT word in a label fails here: reword it, or add it below with the reason.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const RENDERER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'renderer');
const BANNED = /\bSRE\b|\bdevops\b|\bkubernetes\b|\btech stack\b|\bsoftware engineer\b/i;

// file -> why its IT words are not shown as a label or an example to everyone
const ALLOWED = {
  'jobs-view.js': 'detects skill chips in a posting: a tag only appears when the posting itself says it',
  'gallery.js': 'the demo and screenshot gallery, fictional data',
  'strategy-review.js': 'capitalises acronyms in a list the user wrote or the draft proposed',
  'run-cards.js': 'parses the scout\'s run note ("N matching roles", and "N SRE-type roles" in notes written before 5 Oct 2026), never displayed as written',
  'demo.js': 'the demo data',
};
// phrases that stay: an IT example shown next to a non-IT one, or one tip not yet reworded
const ALLOWED_PHRASES = [
  /"Nurse, UK" or "SRE \/ DevOps, Europe"/g,
  // TODO with the next extension version bump: reword this tip. The pool is mirrored into extension/tips-pool.js (extension/sync.sh), and a
  // changed extension file needs a new extension version (desktop/test/extension-version.test.js): not worth a release for one tip.
  /"Kubernetes", not "k8s"/g,
];

const withoutComments = (name, text) => name.endsWith('.html')
  ? text.replace(/<!--[\s\S]*?-->/g, '')
  : text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\w])\/\/.*$/gm, '$1');

test('the renderer\'s words carry no IT-only example or label', () => {
  const files = [...fs.readdirSync(RENDERER).filter(f => /\.(js|html)$/.test(f)).map(f => path.join(RENDERER, f)),
    ...fs.readdirSync(path.join(RENDERER, 'pages')).filter(f => f.endsWith('.js')).map(f => path.join(RENDERER, 'pages', f))];
  const found = [];
  for (const file of files) {
    const name = path.basename(file);
    if (ALLOWED[name]) continue;
    let text = withoutComments(name, fs.readFileSync(file, 'utf8'));
    for (const phrase of ALLOWED_PHRASES) text = text.replace(phrase, '');
    text.split('\n').forEach((line, i) => { if (BANNED.test(line)) found.push(`${path.relative(RENDERER, file)}:${i + 1}: ${line.trim().slice(0, 110)}`); });
  }
  assert.deepEqual(found, [], `IT-only wording in what people read:\n${found.join('\n')}`);
});

test('the allow-list only names files that exist (a rename must not leave a free pass)', () => {
  const all = new Set([...fs.readdirSync(RENDERER), ...fs.readdirSync(path.join(RENDERER, 'pages'))]);
  for (const name of Object.keys(ALLOWED)) assert.ok(all.has(name), `${name} is in the allow-list but not in the renderer`);
});
