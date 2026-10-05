// Mutation testing of the Finder (5 Oct 2026): planted page elements only test the detectors, so they cannot say whether the suites catch a real bug in the
// app's own code. A mutant is one such bug written into critical-path code (mutants.json: a file, an exact text, what replaces it, the suite that should
// catch it). mutation.yml runs each mutant's suite on the mutated app (e2e.yml input `mutant`); a red suite KILLS the mutant, a green one lets it SURVIVE:
// a serious bug the Finder would miss. Each suite also runs once unmutated (`baseline`): a suite that is red anyway says nothing, so its mutants are "unknown". Pure.
export const BASELINE = 'baseline';

// The mutated text, or an error that names why the mutant no longer applies (the code moved on: the mutant must be updated, never silently skipped).
export function applyMutant(source, mutant) {
  const at = source.indexOf(mutant.find);
  if (at < 0) throw new Error(`mutant ${mutant.id}: its text is no longer in ${mutant.file}`);
  if (source.indexOf(mutant.find, at + 1) >= 0) throw new Error(`mutant ${mutant.id}: its text is in ${mutant.file} more than once`);
  return source.slice(0, at) + mutant.replace + source.slice(at + mutant.find.length);
}

// runs: {[mutant id or `baseline:<suite>`]: {conclusion: 'success' | 'failure' | …, findings: ['kind|view', …]}} (a plain conclusion string is read too).
// A mutant is KILLED when its suite went red, or when a detector raised something the unmutated run did not (a truth check files a finding, it does not
// turn the suite red). -> {rows, killed, survived, unknown, score}
const read = value => (typeof value === 'string' ? {conclusion: value, findings: []} : {conclusion: value?.conclusion, findings: value?.findings || []});
export function score(mutants, runs) {
  const rows = mutants.map(mutant => {
    const base = read(runs[`${BASELINE}:${mutant.suite}`]), own = read(runs[mutant.id]);
    const raised = own.findings.filter(item => !base.findings.includes(item));
    const outcome = base.conclusion !== 'success' ? 'unknown' : own.conclusion === 'failure' || (own.conclusion === 'success' && raised.length) ? 'killed'
      : own.conclusion === 'success' ? 'survived' : 'unknown';
    const why = base.conclusion !== 'success' ? `the ${mutant.suite} suite is not green without the mutant (${base.conclusion || 'not run'})` : outcome === 'unknown' ? `the mutant run ended "${own.conclusion || 'not run'}"`
      : outcome === 'killed' ? (own.conclusion === 'failure' ? 'the suite went red' : `found: ${raised.slice(0, 2).join(', ')}`) : '';
    return {id: mutant.id, suite: mutant.suite, what: mutant.what, outcome, why};
  });
  const count = outcome => rows.filter(row => row.outcome === outcome).length;
  const judged = count('killed') + count('survived');
  return {rows, killed: count('killed'), survived: count('survived'), unknown: count('unknown'), score: judged ? Math.round(100 * count('killed') / judged) : null};
}

export function summary(result) {
  const icon = {killed: '✅ caught', survived: '🔴 missed', unknown: '⚪ unknown'};
  return [`## 🧬 Mutation test: ${result.score === null ? 'no result' : `${result.score}% of the planted code bugs caught`} (${result.killed} caught, ${result.survived} missed, ${result.unknown} unknown)`, '',
    '| Mutant | Suite | The bug | Result |', '|---|---|---|---|',
    ...result.rows.map(row => `| \`${row.id}\` | ${row.suite} | ${row.what} | ${icon[row.outcome]}${row.why ? ` (${row.why})` : ''} |`)].join('\n');
}
