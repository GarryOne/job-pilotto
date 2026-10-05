// The resolution label of a verdict file, for the workflows that close an issue: `node resolution.mjs --file .heal/verdict.md` prints e.g. resolution:fp:detector (nothing for a real one).
import fs from 'node:fs';
import {labelOf, resolutionForVerdict} from './lib/resolution.mjs';
import {parse} from './lib/verdict-comment.mjs';

const args = process.argv.slice(2), file = args[args.indexOf('--file') + 1];
const {word, cause} = parse(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
const name = resolutionForVerdict(word, cause);
if (name) console.log(labelOf(name));
