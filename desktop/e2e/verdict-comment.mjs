// Writes the verdict pass's issue comment: node verdict-comment.mjs --file .heal/verdict.md --number N --out .heal/comment.md (verdict word on the file's first line).
// A `real` whose cited code does not exist is rewritten in the file as `needs-human` first (checkEvidence), so the workflow reads the checked word.
import fs from 'node:fs';
import {checkEvidence, verdictComment} from './lib/verdict-comment.mjs';

const args = process.argv.slice(2), at = name => args[args.indexOf(name) + 1];
let raw = fs.existsSync(at('--file')) ? fs.readFileSync(at('--file'), 'utf8') : '';
const lineCount = file => { try { return fs.readFileSync(file, 'utf8').split('\n').length; } catch { return 0; } };
const {word, note} = checkEvidence(raw, lineCount);
if (note) {
  raw = `${word}\n${raw.split('\n').slice(1).join('\n').trim()}\nCheck: ${note}`;
  fs.writeFileSync(at('--file'), raw);
  console.log(note);
}
fs.writeFileSync(at('--out'), verdictComment(raw, {number: Number(at('--number')) || 0, ...(args.includes('--by') ? {by: at('--by')} : {})}));
console.log(`${at('--out')} written`);
