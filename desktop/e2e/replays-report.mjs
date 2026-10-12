// CI's report job of .github/workflows/recorded-pages.yml: every shard's replay results (JP_REPLAY_RESULTS files) sent to /admin/applying's Fixed-site replays in
// ONE PUT with the build's sha, on a push to main only (lib/applying-report.mjs uploadReplays). A case without its control is held back (uploadable). A missing shard
// sends nothing: a partial run would drop its cases from the table. Run: node replays-report.mjs <expected shard count> <results file>...
import fs from 'node:fs';
import {extensionVersion, uploadable, uploadReplays} from './lib/applying-report.mjs';

const [expected, ...files] = process.argv.slice(2);
const found = files.filter(file => fs.existsSync(file));
if (found.length !== Number(expected)) {
  console.log(`replays report: not sent (${found.length} of ${expected} shard results: a partial run would drop cases from the table)`);
} else {
  const results = found.flatMap(file => JSON.parse(fs.readFileSync(file, 'utf8')));
  const {rows, held} = uploadable(results, extensionVersion());
  for (const one of held) console.log(`replays report: ${one.name} held back, ${one.why}`);
  console.log(await uploadReplays(rows.map(({control, ...row}) => row)));
}
