// A new e2e step is seen passing before it lands (6 Oct 2026: "Apply on a saved job without a kit" was pushed without ever passing, and failed the 0.5.8 beta
// gate on its own premise). Pure parts of the pre-push check tools/new-e2e-steps.mjs: which step titles a diff adds, and which of them have no proof.
// Proof is one of: a local run that passed it (artifacts/<suite>/replay.json), or a line in a commit message: "E2E-passed: <run url>" (a suite that only
// runs in CI) or "E2E-unverified: <why>" (said, so it stays visible in the history).

const STEP = /ctx\.run\(\s*(['"`])((?:\\.|(?!\1).)*)/g;
const CLIP = 100;   // replay.json clips step names to 100 characters (lib/replay.mjs)

// The fixed part of a title: a template literal's text before its first ${…} (the rest varies per loop round).
function literal(quote, body) {
  const text = quote === '`' ? body.split('${')[0] : body;
  return text.replace(/\\(.)/g, '$1').trim();
}

export function titlesIn(source) {
  return [...source.matchAll(STEP)].map(match => literal(match[1], match[2])).filter(title => title.length >= 12);
}

// diff: `git diff -U0` text. Titles on added lines that no removed line and no file on the base already has (a moved or untouched step is not new).
export function addedTitles(diff, baseSource = '') {
  const added = titlesIn(diff.split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++')).join('\n'));
  const before = new Set([...titlesIn(diff.split('\n').filter(line => line.startsWith('-') && !line.startsWith('---')).join('\n')), ...titlesIn(baseSource)]);
  return [...new Set(added)].filter(title => !before.has(title));
}

// replays: [{trail: [{name, status}]}] (each suite's last run). seen: step names that passed in ANY earlier run of a suite (artifacts/<suite>/seen-passing.json,
// below): a later run of other steps rewrites replay.json and used to erase the proof (10 Oct 2026). messages: the pushed commits' messages. -> the titles still unproven.
export function unproven(titles, {replays = [], seen = [], messages = []} = {}) {
  if (messages.some(message => /^E2E-(passed|unverified):[ \t]*\S/im.test(message))) return [];
  const passed = [...replays.flatMap(replay => (replay?.trail || []).filter(step => step.status === 'passed').map(step => step.name)), ...seen];
  return titles.filter(title => !passed.some(name => name.startsWith(title.slice(0, CLIP))));
}

// The ledger a suite run adds to: the old names plus the steps this trail passed. It only grows (a failing or filtered run never removes a proof).
export function mergeSeen(old = {}, trail = [], at = new Date().toISOString()) {
  const next = {...old};
  for (const step of trail) if (step?.status === 'passed' && step.name && !next[step.name.slice(0, CLIP)]) next[step.name.slice(0, CLIP)] = at;
  return next;
}

// looked: where the gate searched (shown, so "it ran but is not recorded" can be told from "it ran somewhere else").
export function unprovenMessage(titles, looked = '') {
  return [`a new e2e step has not been seen passing (${titles.length}):`, ...titles.map(title => `  - ${title}`),
    'Run it once, either way counts: `cd desktop/e2e && E2E_STEPS="<step>,<its prerequisites>" node suite.mjs <suite>` or `... node run-all.mjs --only <suite>`.',
    'A passing run is recorded in desktop/e2e/artifacts/<suite>/ of THIS checkout (replay.json + seen-passing.json); a run in another worktree does not count here.',
    ...(looked ? [`Looked in: ${looked}`] : []),
    'For a suite that only runs in CI (gh workflow run e2e.yml --ref <branch> -f suite=<suite>), add "E2E-passed: <run url>" to the commit message.',
    'Cannot run it at all? "E2E-unverified: <why>". And check in the step that its own setup took effect (the stub was called, the seed is there).'].join('\n');
}
