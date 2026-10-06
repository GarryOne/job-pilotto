// A push that changes an e2e suite names the open failed-step issue it answers (6 Oct 2026). #310 and #315 were fixed in the test hours after they were filed, by
// commits that never named them: the issues stayed open and were diagnosed again from scratch. The pre-push check (tools/e2e-issue-links.mjs) lists the open
// failed-step issues of the suites a push touches and asks each to be named: "Fixes #N" (the step is fixed), "Refs #N" (related), or one
// "E2E-issue: none <why>" line. Pure.
const SHARED = 3;   // a helper more suites import than this is shared plumbing: changing it answers no one suite's failure

// suites: {name: source}. -> the suites a changed file belongs to: a suite file is itself and every suite that imports it (they run its steps); a helper in lib/ is
// the suites that import it directly, when few do.
export function suitesOf(files, suites) {
  const importers = target => Object.entries(suites).filter(([, source]) => new RegExp(`from '\\.\\.?/(?:lib/)?${target}\\.mjs'`).test(source)).map(([name]) => name);
  const out = new Set();
  for (const file of files) {
    const suite = /^desktop\/e2e\/suites\/([\w-]+)\.mjs$/.exec(file)?.[1];
    if (suite) { out.add(suite); for (const name of importers(suite)) out.add(name); continue; }
    const helper = /^desktop\/e2e\/lib\/([\w-]+)\.mjs$/.exec(file)?.[1];
    const users = helper ? importers(helper) : [];
    if (users.length && users.length <= SHARED) for (const name of users) out.add(name);
  }
  return [...out].sort();
}

// issues: open `auto-ui` issues ({number, title, labels}). -> the failed-step ones of these suites.
export const openFailures = (issues, suites) => issues.filter(issue => {
  const labels = (issue.labels || []).map(label => label.name || label);
  return labels.includes('kind:test-failure') && suites.some(suite => labels.includes(`suite:${suite}`));
});

// The issues no commit message names (#N anywhere), unless a message says "E2E-issue: none <why>".
export function unnamed(failures, messages) {
  const text = messages.join('\n');
  if (/^E2E-issue:\s*none\s+\S/im.test(text)) return [];
  return failures.filter(issue => !new RegExp(`#${issue.number}\\b`).test(text));
}

export const unnamedMessage = list => ['this push changes e2e suites with open failed-step issues that no commit names:',
  ...list.map(issue => `  #${issue.number} ${String(issue.title || '').slice(0, 90)}`),
  'Say which: "Fixes #N" (this fixes the step), "Refs #N" (related), or a line "E2E-issue: none <why>" in a commit message.'].join('\n');
