// Writes a Bug Tracker row for one GitHub issue the Finder did not find (lib/tracker-write.mjs), run by tracker-sync.yml when an issue closes:
//   node tracker-sync.mjs --issue 123        best effort: it never fails the workflow; no write token = it says so and stops
import {execFileSync} from 'node:child_process';
import {trackerRow, writeTrackerRow} from './lib/tracker-write.mjs';

const args = process.argv.slice(2), number = args[args.indexOf('--issue') + 1];
if (!number) { console.log('usage: node tracker-sync.mjs --issue <number>'); process.exit(0); }
try {
  const view = JSON.parse(execFileSync('gh', ['issue', 'view', number, '--json', 'number,url,title,body,labels,createdAt'], {encoding: 'utf8'}));
  const result = await writeTrackerRow({token: process.env.NOTION_BRAIN_WRITE_TOKEN, db: process.env.BUG_TRACKER_DB, row: trackerRow(view)});
  console.log(`Bug Tracker row for #${number}: ${result.status}${result.why || result.message ? ` (${result.why || result.message})` : ''}`);
} catch (error) { console.log(`Bug Tracker row for #${number}: not written (${String(error.message).slice(0, 120)})`); }
