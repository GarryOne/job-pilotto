// Does the AI still read account pages right? (lib/account-eval.mjs; cases in fixtures/account-pages.json)
//   node account-eval.mjs                 a Mac: this Mac's Claude Code (claude -p, no key, no AI money in the apps); CI: the test key, under a cent a run
//   node account-eval.mjs --only signin   only the cases whose id has this word
//   node account-eval.mjs --out <file>    also writes every case's answer as JSON
//   node account-eval.mjs --engine codex  the app's own adapter for one engine (api | cli | openai | codex), to compare AI families on the same
//                                         pages (owner, 9 Oct 2026); openai reads OPENAI_API_KEY from the environment, codex/cli use this Mac's signed-in CLI
// Exit 1 when fewer than 85% are right or any strict case is wrong.
import fs from 'node:fs';
import {modelClient} from './lib/model.mjs';
import {testKey} from './lib/engine.mjs';
import {fixtureProblems, loadCases, runAll, score} from './lib/account-eval.mjs';

const args = process.argv.slice(2), at = name => (args.includes(name) ? args[args.indexOf(name) + 1] : '');
const cases = loadCases();
const broken = await fixtureProblems(cases);
if (broken.length) { console.error(`the fixture is wrong:\n  ${broken.join('\n  ')}`); process.exit(2); }
const started = Date.now();
// The app's factory (lib/ai/index.js client) on a minimal settings object: the same adapter, model mapping and parsing users run.
async function engineClient(name) {
  const {client, NAMES} = await import('../lib/ai/index.js');
  if (!NAMES.includes(name)) throw new Error(`--engine must be one of ${NAMES.join(', ')}`);
  const {codexBinary} = await import('../lib/ai/codex-cli.js');
  const {execFileSync} = await import('node:child_process');
  const which = bin => { try { return execFileSync('/usr/bin/which', [bin], {encoding: 'utf8'}).trim(); } catch { return ''; } };
  const settings = {aiEngine: name, claudeCode: {path: which('claude')}, codex: {path: codexBinary()}};
  const made = client({settings: () => settings, secret: key => process.env[key] || ''});
  if (!made) throw new Error(`no ${name} client: its key is missing (OPENAI_API_KEY / ANTHROPIC_API_KEY)`);
  return made;
}
const engine = at('--engine');
const rows = await runAll(engine ? await engineClient(engine) : modelClient({key: testKey()}), cases, {only: at('--only')});
const result = score(rows);
const show = value => JSON.stringify(value);
for (const row of rows) console.log(`${row.right ? '✓' : row.strict ? '✗ STRICT' : '✗'} ${row.part.padEnd(13)} ${row.id}${row.right ? '' : `: expected ${show(row.expected)}, got ${show(row.got)}`}`);
const line = `Account-page eval${engine ? ` (${engine})` : ''}: ${result.right} of ${result.total} right (${Math.round(result.share * 100)}%, needs ${85}%)${result.strictWrong.length ? `; strict wrong: ${result.strictWrong.join(', ')}` : ''}; ${Math.round((Date.now() - started) / 1000)} s`;
console.log(`\n${result.pass ? 'PASS' : 'FAIL'} ${line}`);
if (at('--out')) fs.writeFileSync(at('--out'), JSON.stringify({...result, rows}, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${result.pass ? '✅' : '❌'} ${line}\n${rows.filter(row => !row.right).map(row => `- ${row.strict ? '**strict** ' : ''}${row.id}: expected ${show(row.expected)}, got ${show(row.got)}`).join('\n')}\n`);
process.exit(result.pass ? 0 : 1);
