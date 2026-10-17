// Why an e2e suite went red (owner, 18 Oct 2026: "facts first, $0"): ONE pure function from facts to a cause, shared by the collector (tools/e2e-intel.mjs) and the page. No AI;
// when "unknown" grows past 20% of the reds, an AI step with a fixed answer may take only those. Guard: test/e2e-causes.test.js.
import {isTest} from './ops-categories.js';

export const CAUSES = [
  {id: 'credit', label: 'AI credit', color: '#e5484d', hint: 'the AI key had no credit or quota left (HTTP 429 insufficient_quota, "credit balance is too low")'},
  {id: 'infra', label: 'Runner / infra', color: '#8d949c', hint: 'the runner failed before the suite ran, was cancelled, or its fix only changed workflows or tools'},
  {id: 'flake', label: 'Flake', color: '#f5b54a', hint: 'red, then green on the second try with the same code'},
  {id: 'test', label: 'Test bug', color: '#3987e5', hint: 'the fix that turned the suite green changed only tests or the e2e harness'},
  {id: 'product', label: 'Product bug', color: '#a78bfa', hint: 'the fix changed the app, the extension or the engine'},
  {id: 'open', label: 'Not fixed yet', color: '#d95926', hint: 'no later run of the suite has passed on new code'},
  {id: 'unknown', label: 'Unknown', color: '#5b6b7a', hint: 'the fix could not be read from GitHub'},
];
export const CAUSE_IDS = CAUSES.map(cause => cause.id);
export const RULES_VERSION = 1;
const MAX_FIX_FILES = 30;

const CREDIT = /insufficient_quota|credit balance is too low|exceeded your current quota|billing_hard_limit/i;
const INFRA = /runner has received a shutdown signal|lost communication with the server|The operation was canceled|No space left on device/i;

// "E2E · Windows · apply" -> {suite: 'apply', platform: 'windows'}; any other job -> null.
export function suiteOfJob(name = '') {
  const match = /^E2E · (Windows|Mac \+ Linux) · (.+)$/.exec(name);
  return match ? {suite: match[2].trim(), platform: match[1] === 'Windows' ? 'windows' : 'mac'} : null;
}

const isHarness = path => path.startsWith('desktop/e2e/') || isTest(path);
const isTooling = path => /^(\.github|\.claude|tools|docs)\//.test(path);

// facts: {jobConclusion, failedStep, log (failing job's text), rerun ('success'|'failure'|undefined), fixFiles (files changed between this red and the next green on the suite; null = not readable, [] = none yet)}
export function causeOf({jobConclusion, failedStep = '', log = '', rerun, fixFiles = null}) {
  if (log !== null && CREDIT.test(log)) return 'credit';
  if (jobConclusion === 'cancelled' || failedStep === 'Set up job' || (log !== null && INFRA.test(log))) return 'infra';
  if (rerun === 'success') return 'flake';
  if (fixFiles === null || log === null) return 'unknown';   // log === null: the log was not read, so an empty credit cannot be ruled out
  if (!fixFiles.length) return 'open';
  if (fixFiles.length > MAX_FIX_FILES) return 'unknown';   // many unrelated commits landed before the suite passed again: the files say nothing about the fix
  if (fixFiles.every(isHarness)) return 'test';   // a mix of tests and tooling below counts as infra
  return fixFiles.every(path => isHarness(path) || isTooling(path)) ? 'infra' : 'product';
}
