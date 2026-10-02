// Which suites a run starts. A push to main runs only the suites whose files changed (every test-file push used to run all of them, and the shared test key's
// AI credit ran out); a schedule or a manual run runs all, or the ones named. The CI matrix is built from this (suite.mjs --list).
const SMOKE = 'settings';   // AI-free, about 30 s: proof that the shared test code still launches the app and drives a page

export function suitesFor(files, all) {
  const chosen = new Set();
  for (const file of files.map(name => String(name).trim()).filter(Boolean)) {
    const suite = /^desktop\/e2e\/suites\/([^/]+)\.mjs$/.exec(file)?.[1];
    if (suite) { if (all.includes(suite)) chosen.add(suite); continue; }
    if (/^extension\//.test(file)) { chosen.add('apply'); continue; }
    if (/^desktop\/e2e\/test\//.test(file) || /\.md$/.test(file)) continue;   // unit tests run on their own; docs run nothing
    if (/^desktop\/e2e\//.test(file) || file === '.github/workflows/e2e.yml') chosen.add(SMOKE);
  }
  return all.filter(suite => chosen.has(suite));
}

// A manual run's `suite` input: "" = all, else a comma-separated list.
export function suitesNamed(text, all) {
  const names = String(text || '').split(',').map(name => name.trim()).filter(Boolean);
  const unknown = names.filter(name => !all.includes(name));
  if (unknown.length) throw new Error(`unknown suite: ${unknown.join(', ')} (known: ${all.join(', ')})`);
  return names.length ? all.filter(suite => names.includes(suite)) : all;
}
