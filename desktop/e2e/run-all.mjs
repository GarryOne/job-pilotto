// Runs the suites on this Mac, one after the other (or a few at a time), and prints one table:   npm run all
//   npm run all                        every suite that is not manual (what a manual CI run with no names does)
//   npm run all -- --only jobs,quality  exactly these, even a manual one
//   npm run all -- --manual            also the manual suites (personas)
//   npm run all -- --skip quality,wizard  leave these out;   --parallel 3  three at a time (needs each suite's own Notion token)
// Secrets come from the environment, else from the macOS Keychain (job-pilotto.e2e.anthropic_key, .notion_token, .notion_token_<suite>). A suite without its
// own token falls back to the wizard's (lib/context.mjs), so on a Mac without them the suites must run one at a time (the default).
import {execFileSync, spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {autoSuites, suitesNamed} from './lib/plan.mjs';
import {SKIPPED, summarize} from './lib/skip.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// -> the suites to run, in order. only: names (all of them allowed); skip: names to leave out; manual: include the manual suites.
export function pickSuites({all, cadence = {}, only = '', skip = '', manual = false}) {
  const names = text => String(text || '').split(',').map(name => name.trim()).filter(Boolean);
  const chosen = names(only).length ? suitesNamed(only, all) : manual ? all : autoSuites(all, cadence);
  const unknown = names(skip).filter(name => !all.includes(name));
  if (unknown.length) throw new Error(`unknown suite to skip: ${unknown.join(', ')}`);
  return chosen.filter(suite => !names(skip).includes(suite));
}

// -> the secrets a run needs that are not in the environment yet, read from the Keychain (nothing is printed or written).
export function keychainEnv(suites, {env = process.env, read = defaultRead} = {}) {
  const wanted = [['E2E_ANTHROPIC_KEY', 'anthropic_key'], ['E2E_NOTION_TOKEN', 'notion_token'], ...suites.map(suite => [`E2E_NOTION_TOKEN_${suite.toUpperCase()}`, `notion_token_${suite}`])];
  const found = {};
  for (const [variable, item] of wanted) {
    if (env[variable]) continue;
    const value = read(`job-pilotto.e2e.${item}`);
    if (value) found[variable] = value;
  }
  return found;
}
function defaultRead(service) {
  if (process.platform !== 'darwin') return '';
  try { return execFileSync('security', ['find-generic-password', '-a', 'job-pilotto', '-s', service, '-w'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim(); } catch { return ''; }
}

const run = (suite, env, quiet) => new Promise(resolve => {
  const started = Date.now();
  const log = quiet ? fs.openSync(path.join(HERE, 'artifacts', `${suite}.run.log`), 'w') : null;
  const child = spawn('node', ['suite.mjs', suite], {cwd: HERE, env: {E2E_SKIP_EXIT: String(SKIPPED), ...env}, stdio: quiet ? ['ignore', log, log] : 'inherit'});
  child.on('exit', code => resolve({suite, code: code ?? 1, seconds: Math.round((Date.now() - started) / 1000)}));
});

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const option = flag => { const at = process.argv.indexOf(flag); return at < 0 ? '' : process.argv[at + 1] || ''; };
  const {SUITES} = await import('./lib/context.mjs');
  const cadence = {};
  for (const suite of SUITES) { const module = await import(`./suites/${suite}.mjs`); if (module.cadence) cadence[suite] = module.cadence; }
  let suites;
  try { suites = pickSuites({all: SUITES, cadence, only: option('--only'), skip: option('--skip'), manual: process.argv.includes('--manual')}); } catch (error) { console.error(error.message); process.exit(2); }
  const env = {...process.env, ...keychainEnv(suites)};
  const parallel = Math.max(1, Number(option('--parallel')) || 1);
  console.log(`Running ${suites.length} suite(s)${parallel > 1 ? `, ${parallel} at a time` : ' one after the other'}: ${suites.join(', ')}\n`);
  fs.mkdirSync(path.join(HERE, 'artifacts'), {recursive: true});
  const results = [], queue = [...suites];
  await Promise.all(Array.from({length: parallel}, async () => {
    while (queue.length) results.push(await run(queue.shift(), env, parallel > 1));
  }));
  results.sort((a, b) => suites.indexOf(a.suite) - suites.indexOf(b.suite));
  const summary = summarize(results, {parallel, requireSecrets: env.E2E_REQUIRE_SECRETS === '1'});
  console.log('\n' + summary.text);
  process.exit(summary.exit);
}
