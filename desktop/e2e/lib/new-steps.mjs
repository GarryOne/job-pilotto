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

// replays: [{trail: [{name, status}]}]. messages: the pushed commits' messages. -> the titles still unproven.
export function unproven(titles, {replays = [], messages = []} = {}) {
  if (messages.some(message => /^E2E-(passed|unverified):[ \t]*\S/im.test(message))) return [];
  const passed = replays.flatMap(replay => (replay?.trail || []).filter(step => step.status === 'passed').map(step => step.name));
  return titles.filter(title => !passed.some(name => name.startsWith(title.slice(0, CLIP))));
}

export function unprovenMessage(titles) {
  return [`a new e2e step has not been seen passing (${titles.length}):`, ...titles.map(title => `  - ${title}`),
    'Run it once (E2E_STEPS="<step>,<its prerequisites>" node run-all.mjs --only <suite>), or, for a suite that only runs in CI',
    '(gh workflow run e2e.yml --ref <branch> -f suite=<suite>), add "E2E-passed: <run url>" to the commit message.',
    'Cannot run it at all? "E2E-unverified: <why>". And check in the step that its own setup took effect (the stub was called, the seed is there).'].join('\n');
}
