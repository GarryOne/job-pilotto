// npm run cv-facts-cases [-- --times 3]: school, degree, years, current company and job title asked on a form in three languages (lib/cv-facts-cases.mjs), through the plain-node
// app's fill route on the plan path (claude -p; no API key, no money). Exit 1 when any ask misses a field.
import {CASES, appAsk, runCases, summarize} from './lib/cv-facts-cases.mjs';
import {startOfflineApp} from './lib/offline-app.mjs';

const at = process.argv.indexOf('--times'), times = at > 0 ? Math.max(1, Number(process.argv[at + 1]) || 3) : 3;
console.log(`cv facts cases: ${CASES.length} forms x ${times} asks, the seeded fake applicant, the plan path (claude -p)`);
const ask = appAsk({startOfflineApp});
try {
  const {ok, line} = summarize(await runCases(ask, {times, say: console.log}));
  console.log(line);
  process.exitCode = ok ? 0 : 1;
} finally { await ask.close(); }
