// node tools/unproven-fixes.mjs: the Fixed tab's fixes that no CI run has proven live yet, one ready-to-dispatch line each (owner, 12 Oct 2026; the coordinator runs them the
// next day, when a site's CI visits are back): "<row>\t<commit>\tgh workflow run record-sites.yml --ref main -f only='<row>' -f share=1". Reads /admin/applying?json (the owner
// key from the Keychain item job-pilotto.site.api_key, never printed). Guard: desktop/e2e/test/pool-proven.test.mjs.
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const quote = text => `'${String(text).replace(/'/g, "'\\''")}'`;

// fixed: the page JSON's fixed.rows ({site, commit, landedAt, proven}) -> [line], newest landing first.
export const dispatchLines = fixed => [...fixed].filter(row => !row.proven).sort((a, b) => String(b.landedAt).localeCompare(String(a.landedAt)))
  .map(row => `${row.site}\t${row.commit}\tgh workflow run record-sites.yml --ref main -f only=${quote(row.site)} -f share=1`);

async function main() {
  const key = execFileSync('security', ['find-generic-password', '-s', 'job-pilotto.site.api_key', '-w'], {encoding: 'utf8'}).trim();   // never printed
  const answer = await fetch('https://www.jobpilotto.top/admin/applying?json', {headers: {Authorization: `Bearer ${key}`, 'X-Caller': 'unproven-fixes'}, signal: AbortSignal.timeout(20000)});
  if (!answer.ok) { console.error(`unproven-fixes: the page answered ${answer.status}`); process.exit(1); }
  const lines = dispatchLines((await answer.json())?.fixed?.rows || []);
  console.log(lines.length ? lines.join('\n') : 'every fix is proven live');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
