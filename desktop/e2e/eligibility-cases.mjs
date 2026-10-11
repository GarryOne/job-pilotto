// npm run eligibility-cases [-- --times 3]: the eligibility judgment on its own (lib/eligibility-cases.mjs): five invented postings against the seeded fake applicant,
// each asked through the plain-node app's fill route on the plan path (claude -p; no API key, no money). Prints one line per ask and the summary; exit 1 when a case
// is judged wrong by majority. Pool runs turn the stop off (lib/pool-eligibility.mjs), so this is where the judgment stays tested.
import {CASES, appAsk, runCases, summarize} from './lib/eligibility-cases.mjs';
import {startOfflineApp} from './lib/offline-app.mjs';
import {seedLivePosting} from './lib/seed-data.mjs';
import {storeCall} from './lib/store-call.mjs';

const at = process.argv.indexOf('--times'), times = at > 0 ? Math.max(1, Number(process.argv[at + 1]) || 3) : 3;
console.log(`eligibility cases: ${CASES.length} postings x ${times} asks, the seeded fake applicant, the plan path (claude -p)`);
const ask = appAsk({startOfflineApp, seedLivePosting, storeCall});
try {
  const {ok, line} = summarize(await runCases(ask, {times, say: console.log}));
  console.log(line);
  process.exitCode = ok ? 0 : 1;
} finally { await ask.close(); }
