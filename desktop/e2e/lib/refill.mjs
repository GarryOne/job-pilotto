// The rules of the CI refill (.github/workflows/replay-refill.yml; owner, 15 Oct 2026: "a separate CI workflow only for that, with a separate Anthropic API Key"): which pinned rows
// to refill, what it may cost, which key it may use, and which PRs may start it. Pure parts; guard: e2e/test/refill.test.mjs. The key REPLAY_REFILL_ANTHROPIC_KEY has NO fallback
// (no Tests key, no live-pool key): missing = the job says so and stops. Fake applicant only, a replay of the network record (no site visit), never Submit.
import {askChanged, outdated} from '../replay-gate.mjs';

export const SECRET = 'REPLAY_REFILL_ANTHROPIC_KEY';
export const FLAG = 'JP_REFILL_CI';   // set by the workflow only: the fill replay may ask the API on CI (lib/ai/model-memo.js fillOn, lib/offline-app.mjs)
export const MAX_ASKS = 40;           // a run refuses to start above this many asks (workflow input max_asks lowers or raises it by hand)
export const PER_ASK_USD = 0.06;      // the estimate printed before it starts (the plan path's measured price per ask, 15 Oct 2026; the first CI run measures the API's own)
export const MAX_USD = 3;
export const ROW_MAX_CALLS = 30;     // one row's paid calls: the proxy refuses the next one (lib/ai-proxy.mjs maxCalls)
export const refillCap = (env = process.env) => Number(env.REFILL_ROW_MAX_CALLS) || ROW_MAX_CALLS;             // a run stops asking above this (the org's prepaid credits are small; the key's workspace has its own monthly limit)

// The key, or '' (never another key's value).
export const refillKey = (env = process.env) => String(env[SECRET] || '');
export const keyRefusal = (env = process.env) => (refillKey(env) ? '' : `refill: no ${SECRET} secret: nothing was asked (this workflow never runs on another key)`);

// A PR from a fork never gets the key (isCrossRepository from `gh pr view --json isCrossRepository`; a missing answer counts as a fork).
export const forkRefusal = pr => (pr && pr.isCrossRepository === false ? '' : `refill: PR ${pr?.number ?? '?'} is from a fork or unknown: the key is never given to it`);

// A replay record the refill is for: the ask changed (page-side), or the prompt changed (instructions only): the gate's own two verdicts (replay-gate.mjs).
export const needsRefill = record => !!record && !record.deferred && (outdated(record.firstMiss) || askChanged(record));

// (pinned names, the PR gate's replay records {name, network:{extra}, firstMiss}, all) -> {rows: [{name, asks}], asks, usd}
// all: every pinned row (the PR gate replays one row per kind, so a pinned row it did not replay is unknown); else only the pinned rows the gate saw needing it.
export function pickRefill({pins = [], records = [], all = false} = {}) {
  const byName = new Map(records.map(record => [record.name, record])), rows = [];
  for (const name of [...pins].sort()) {
    const record = byName.get(name);
    if (all || needsRefill(record)) rows.push({name, asks: Math.max(1, Number(record?.network?.extra) || 0)});
  }
  const asks = rows.reduce((sum, row) => sum + row.asks, 0);
  return {rows, asks, usd: Math.round(asks * PER_ASK_USD * 100) / 100};
}

// -> '' (go ahead) or why the run refuses to start.
export const capRefusal = ({asks, usd}, {maxAsks = MAX_ASKS, maxUsd = MAX_USD} = {}) => (asks > maxAsks ? `refill: ${asks} asks (about $${usd.toFixed(2)}) is above the cap of ${maxAsks}: raise max_asks by hand if that is meant`
  : usd > maxUsd ? `refill: about $${usd.toFixed(2)} is above the $${maxUsd} cap` : '');

// The API's answer for an empty balance or a spent limit (lib/ai-meter.mjs countError keys: "<status> <type>: <message>").
export const outOfCredits = errors => Object.keys(errors || {}).some(key => /credit balance is too low|spend limit|usage limits/i.test(key));
export const creditsLine = `refill: OUT OF CREDITS: the API refused the refill key's calls (the org's prepaid balance or the workspace's monthly limit); add credit in the Anthropic console, then run it again`;

// The workflow's group split: one row per runner.
export const matrixOf = rows => rows.map(row => row.name);
