// Writes the verdict pass's issue comment: node verdict-comment.mjs --file .heal/verdict.md --number N --out .heal/comment.md (verdict word on the file's first line).
import fs from 'node:fs';
import {verdictComment} from './lib/verdict-comment.mjs';

const args = process.argv.slice(2), at = name => args[args.indexOf(name) + 1];
const raw = fs.existsSync(at('--file')) ? fs.readFileSync(at('--file'), 'utf8') : '';
fs.writeFileSync(at('--out'), verdictComment(raw, {number: Number(at('--number')) || 0}));
console.log(`${at('--out')} written`);
