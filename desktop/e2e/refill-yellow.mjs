// CLI of the refill's yellow state (lib/refill-yellow.mjs): reads the groups' report files, prints the summary line and writes the merged set; --alert sends ONE Telegram message when the set changed since the run before.
//   node refill-yellow.mjs <merged out file> <report file>... [--previous <merged file of the run before>] [--alert]      (CI_ALERTS_* and GITHUB_* from the runner)
import fs from 'node:fs';
import {line, merge, message, sameSet} from './lib/refill-yellow.mjs';
import {send} from './ci-alert.mjs';

const args = process.argv.slice(2), flag = name => args[args.indexOf(name) + 1];
const files = args.filter((one, at) => !one.startsWith('--') && !['--previous'].includes(args[at - 1]));
const [out, ...reports] = files, read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const merged = merge(reports.map(read));
fs.writeFileSync(out, JSON.stringify(merged));
if (!merged.rerecord.length) console.log('refill: every refused row is gone: nothing needs a re-record');
else {
  console.log(line(merged));
  if (args.includes('--alert')) {
    const previous = args.includes('--previous') ? read(flag('--previous')) : null, env = process.env;
    if (sameSet(merged, previous)) console.log('refill: the same rows need a re-record as in the run before: no new alert');
    else console.log(await send(message(merged, `${env.GITHUB_SERVER_URL || 'https://github.com'}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`)));
  }
}
