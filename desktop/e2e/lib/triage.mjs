// The self-healing loop's judgement, as plain functions (no network): which findings are worth an issue, which one is ready for a fix, and
// what a fix may touch. triage.mjs (the producer's CLI), pick.mjs (the fixer's) and .github/workflows/ui-findings.yml, ui-fix.yml call these; tests/triage.test.mjs pins the rules.
// This file is the entry: the rules live in triage-findings.mjs, triage-issues.mjs and triage-match.mjs (a pure move, 8 Oct 2026); callers import from here.
export * from './triage-findings.mjs';
export * from './triage-issues.mjs';
export * from './triage-match.mjs';
