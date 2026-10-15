// The scheduled replay's late-answer pass verdict (lib/lost-answers.mjs over each row's app log): one line per row that lost Claude's answers. Report only.
//   node replay-late.mjs <replays dir>   (replay-records.mjs's <out>/replays: a folder per row with its app.log)
import fs from 'node:fs';
import path from 'node:path';
import {lostAnswers} from './lib/lost-answers.mjs';

const dir = process.argv[2];
if (!dir) { console.error('usage: node replay-late.mjs <replays dir>'); process.exit(2); }
const rows = fs.existsSync(dir) ? fs.readdirSync(dir).filter(name => fs.existsSync(path.join(dir, name, 'app.log'))) : [];
const lost = rows.map(name => ({name, ...lostAnswers(fs.readFileSync(path.join(dir, name, 'app.log'), 'utf8'))})).filter(row => row.lost);
console.log(`## Late answers (Claude's answers delayed 4 s): ${lost.length ? `🔻 ${lost.length}` : '0'} of ${rows.length} rows lost them`);
for (const row of lost) console.log(`- ${row.name}: ${row.why}`);
