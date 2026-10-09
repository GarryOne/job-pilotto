// The account-page AI eval (owner, 9 Oct 2026): do the two AIs behind sign-in and sign-up still read real account pages right, in any language? The fixture e2e
// (applyflows) proves the chain with a stand-in AI; this proves the AI half with the real model, on outlines shaped like the pages live and twin runs met
// (fixtures/account-pages.json). It goes through the app's own code, desktop/lib/page-kind.js pageKind and desktop/lib/account-judge.js judgeAccount (their prompts,
// schemas and validation), so a prompt change that breaks a language or a shape shows here. Run: account-eval.mjs. Guard: test/account-eval.test.mjs.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';

// The app's own code, loaded once. It imports desktop/shared/ (made by desktop/scripts/stage.mjs before the app's own tests and start): staged here when missing, files only (CI's plan job has no desktop dependencies: the bot bundle's esbuild failed there, 9 Oct 2026).
let app = null;
export async function appCode() {
  if (app) return app;
  if (!fs.existsSync(new URL('../../shared/alias-schema.js', import.meta.url))) execFileSync(process.execPath, [fileURLToPath(new URL('../../scripts/stage.mjs', import.meta.url)), '--files-only'], {stdio: 'ignore'});
  const [kind, judge] = await Promise.all([import('../../lib/page-kind.js'), import('../../lib/account-judge.js')]);
  app = {pageKind: kind.pageKind, KINDS: kind.KINDS, judgeAccount: judge.judgeAccount, READY: judge.READY, RESULT: judge.RESULT};
  return app;
}

export const SHARE = 0.85;   // of all cases, the share that must be right (a model answers differently now and then); every `strict` case must be right
const FIXTURE = new URL('../fixtures/account-pages.json', import.meta.url);
const STEPS = ['sign_in', 'sign_up', 'choose', ''];

export const loadCases = (file = FIXTURE) => JSON.parse(fs.readFileSync(file, 'utf8'));
const pathOf = url => { try { return new URL(String(url)).pathname.slice(0, 120); } catch { return ''; } };

// Mistakes in the fixture itself (an answer the code does not know, a control the page does not list): the eval would score a case no model can get right.
export async function fixtureProblems(cases) {
  const {KINDS, READY, RESULT} = await appCode();
  const problems = [], ids = new Set();
  for (const item of [...cases.kind, ...cases.judge]) {
    if (ids.has(item.id)) problems.push(`${item.id}: the id is used twice`);
    ids.add(item.id);
  }
  for (const item of cases.kind) {
    const {expect, page} = item, buttons = page.buttons || [];
    if (!KINDS.includes(expect.kind)) problems.push(`${item.id}: kind "${expect.kind}" is not one of ${KINDS.join(', ')}`);
    if (expect.account_step !== undefined && !STEPS.includes(expect.account_step)) problems.push(`${item.id}: account step "${expect.account_step}"`);
    for (const field of ['account_button', 'register_control', 'signin_control', 'apply_button']) if (expect[field] && !buttons.includes(expect[field])) problems.push(`${item.id}: ${field} "${expect[field]}" is not one of the page's buttons`);
  }
  for (const item of cases.judge) {
    const {expect, page, phase} = item;
    if (!['ready', 'result'].includes(phase)) problems.push(`${item.id}: phase "${phase}"`);
    if (expect.answer && !(phase === 'result' ? RESULT : READY).includes(expect.answer)) problems.push(`${item.id}: answer "${expect.answer}" is not a ${phase} answer`);
    const labels = [...(page.controls || []).map(control => control.label), ...(page.buttons || [])];
    if (expect.needs && !labels.includes(expect.needs)) problems.push(`${item.id}: needs "${expect.needs}" is not a label on the page`);
  }
  return problems;
}

// One case -> {id, strict, right, expected, got}. `got` is what the app's code kept of the model's answer (after its own validation), as the extension would see it.
const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();   // the app keeps some labels lower-cased (applyButtonOf)
const WORD = {account_step: 'accountStep', account_button: 'accountButton', register_control: 'registerControl', signin_control: 'signinControl', apply_button: 'applyButton'};
export async function runKind(client, item) {
  const {pageKind} = await appCode();
  const answer = await pageKind(client, item.page, null);
  const got = answer.error ? {error: answer.error, ...(answer.kind ? {kind: answer.kind} : {})} : {kind: answer.kind, ...Object.fromEntries(Object.entries(WORD).map(([field, key]) => [field, answer[key] || '']))};
  const wrong = Object.entries(item.expect).filter(([field, value]) => !same(got[field], value)).map(([field]) => field);
  return {id: item.id, part: 'kind', strict: !!item.strict, right: !got.error && !wrong.length, wrong, expected: item.expect, got, usd: answer.usd || 0};
}
export async function runJudge(client, item) {
  const {judgeAccount} = await appCode();
  const raw = {...item.page, fromPath: item.page.fromUrl ? pathOf(item.page.fromUrl) : ''};   // sameForm: what the extension says after comparing the form's outline (extension/account-step.js formOutline)
  const answer = await judgeAccount(client, raw, item.phase);
  const got = answer.error ? {error: answer.error} : {answer: answer.answer, needs: answer.needs || '', needs_kind: answer.needsKind || '', bot_check: !!answer.botCheck};
  const wrong = Object.entries(item.expect).filter(([field, value]) => !same(got[field], value)).map(([field]) => field);
  return {id: item.id, part: `judge ${item.phase}`, strict: !!item.strict, right: !got.error && !wrong.length, wrong, expected: item.expect, got, usd: 0};
}

// Every case, a few at a time (each is one model call), in the fixture's order.
export async function runAll(client, cases, {only = '', parallel = 4} = {}) {
  const work = [...cases.kind.map(item => () => runKind(client, item)), ...cases.judge.map(item => () => runJudge(client, item))]
    .filter((_, index) => !only || [...cases.kind, ...cases.judge][index].id.includes(only));
  const rows = new Array(work.length);
  let next = 0;
  await Promise.all(Array.from({length: Math.min(parallel, work.length)}, async () => { while (next < work.length) { const at = next++; rows[at] = await work[at](); } }));
  return rows;
}

export function score(rows) {
  const right = rows.filter(row => row.right).length, strictWrong = rows.filter(row => row.strict && !row.right);
  const share = rows.length ? right / rows.length : 0;
  return {right, total: rows.length, share, strictWrong: strictWrong.map(row => row.id), pass: rows.length > 0 && share >= SHARE && !strictWrong.length};
}
