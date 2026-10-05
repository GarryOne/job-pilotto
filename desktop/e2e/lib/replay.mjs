// How a finding was found, as data (5 Oct 2026). An issue used to say it only sometimes: 10 of the first 66 carried a variation block, 13 a seed, 5 a window, and the gate's fixed path
// was not said at all. Time zone, language, theme and the pages and controls the probe pressed were nowhere. Every suite now writes replay.json (the run's type, its path, its window,
// its place, the steps it took) and every issue says "How it was found" with the exact command that walks the same path again, plus the same facts as one hidden JSON line a later
// step (the stats, a person's script) can read. Pure: the suite runner gathers the facts, this builds, renders and parses them.
export const REPLAY_VERSION = 1;

const EVENTS = {
  schedule: 'scheduled run (three a day, a new path each time)',
  workflow_run: 'release gate (fixed path)',
  workflow_dispatch: 'run started by hand',
  push: 'run for a push',
  local: 'run on a developer\'s Mac',
};
export const eventOf = env => String(env.GITHUB_EVENT_NAME || (env.CI ? 'ci' : 'local'));
export const runTypeWords = event => EVENTS[event] || `run (${event})`;

const sha7 = value => String(value || '').slice(0, 7);
const platformOf = platform => ({darwin: 'mac', win32: 'windows'}[platform] || platform || 'unknown');
const clip = (text, max) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);

// The facts of one suite run. `vary` {seed, fixed}; `place` {zone, locale} | null; `window` [w, h] | null; `trail` [{name, status, seconds}]; `path` {pages: [], pressed: []} | null.
export function buildReplay({suite, env = {}, vary = {seed: 0, fixed: true}, place = null, window = null, theme = null, platform = process.platform, trail = [], path = null, detail = '', at = new Date().toISOString()} = {}) {
  const event = eventOf(env), seed = vary.fixed ? 0 : vary.seed;
  const runUrl = env.GITHUB_RUN_ID && env.GITHUB_REPOSITORY ? `${env.GITHUB_SERVER_URL || 'https://github.com'}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : '';
  return {
    v: REPLAY_VERSION, suite, at, event, runType: runTypeWords(event), mode: vary.fixed ? 'fixed' : 'seeded', seed,
    window: Array.isArray(window) && window.length === 2 ? window.map(Number) : null,
    zone: place?.zone || '', locale: place?.locale || '', theme: theme || '',
    platform: platformOf(platform), commit: sha7(env.GITHUB_SHA || env.SHA), run: runUrl, detail: clip(detail, 300),
    trail: trail.map(step => ({name: clip(step.name, 100), status: step.status, ...(step.seconds ? {seconds: Number(step.seconds)} : {})})),
    path: path ? {pages: (path.pages || []).slice(0, 30), pressed: (path.pressed || []).slice(0, 300)} : null,
  };
}

// The command that walks the same path again. A fixed path needs no seed; the window, time zone and language of a seeded run come from the seed (lib/variation.mjs).
export function replayCommand(replay) {
  const seed = replay.mode === 'seeded' && replay.seed ? `E2E_SEED=${replay.seed} ` : '';
  return `cd desktop/e2e && ${seed}node suite.mjs ${replay.suite}`;
}

const stepLine = step => `- ${step.status === 'passed' ? '✓' : step.status === 'failed' ? '✗' : '–'} ${step.name}${step.seconds ? ` (${step.seconds}s)` : ''}`;

// The "How it was found" block of an issue: what a person needs to see the same thing, in a few lines; the long lists fold.
export function replayBlock(replay, {platform = '', build = '', withCommand = true} = {}) {
  const place = [replay.zone, replay.locale].filter(Boolean).join(', ');
  const rows = [
    ['Run', `${replay.runType} · suite \`${replay.suite}\`${platform ? ` · ${platform}` : ''}`],
    ['Path', replay.mode === 'fixed' ? 'the fixed path: the same pages, controls and data every time' : `seeded: \`E2E_SEED=${replay.seed}\` shuffles the pages, the controls and the form data`],
    ['Window', [replay.window ? `${replay.window.join('×')} px` : 'the default window', replay.theme ? `${replay.theme} theme` : '', place].filter(Boolean).join(' · ')],
    ['Build', [replay.commit ? `\`${replay.commit}\`` : '', build].filter(Boolean).join(' · ') || 'not recorded'],
    ...(replay.run ? [['Run page', replay.run]] : []),
    ...(replay.detail ? [['This run', replay.detail]] : []),
  ];
  const out = ['### How it was found', '', '| | |', '|---|---|', ...rows.map(([name, value]) => `| ${name} | ${String(value).replace(/\|/g, '/')} |`), ...(withCommand ? ['', '```sh', replayCommand(replay), '```'] : [])];
  if (replay.trail?.length) {
    const shown = replay.trail.slice(-12);
    out.push('', `<details><summary>The suite's steps before this finding (${replay.trail.length})</summary>`, '', ...(replay.trail.length > shown.length ? [`- … ${replay.trail.length - shown.length} earlier step(s)`] : []), ...shown.map(stepLine), '', '</details>');
  }
  if (replay.path?.pressed?.length || replay.path?.pages?.length) {
    const pressed = (replay.path.pressed || []).slice(0, 40);
    out.push('', `<details><summary>The probe's path: ${replay.path.pages.length} page(s), ${(replay.path.pressed || []).length} control(s) pressed</summary>`, '', ...(replay.path.pages.length ? [`Pages, in order: ${replay.path.pages.join(' → ')}`, ''] : []),
      ...pressed.map(item => `- ${item.view || ''}: "${clip(item.name, 60)}"${item.effects ? ` → ${clip(item.effects, 60)}` : ''}${item.flagged ? ' ⚑' : ''}`), ...((replay.path.pressed || []).length > pressed.length ? [`- … ${(replay.path.pressed || []).length - pressed.length} more`] : []), '', '</details>');
  }
  return out.join('\n');
}

// The same facts as one hidden JSON line, kept small (the trail and the path are cut): a later step reads it with parseReplay.
export function replayComment(replay) {
  const small = {...replay, trail: (replay.trail || []).slice(-12), path: replay.path ? {pages: replay.path.pages, pressed: (replay.path.pressed || []).slice(0, 30)} : null};
  return `<!-- replay: ${JSON.stringify(small).replace(/--/g, '- -')} -->`;
}
export function parseReplay(body) {
  const hit = /<!-- replay: (\{[\s\S]*?\}) -->/.exec(String(body || ''));
  if (!hit) return null;
  try { const data = JSON.parse(hit[1].replace(/- -/g, '--')); return data?.v === REPLAY_VERSION ? data : null; } catch { return null; }
}

// An older artifact folder has only seed.json ({seed, fixed, window, detail}): the replay it implies, so every issue says how it was found.
export function replayFromSeed(seedFile, {suite, env = {}, platform = process.platform} = {}) {
  if (!seedFile || typeof seedFile !== 'object') return null;
  const replay = buildReplay({suite, env, vary: {seed: Number(seedFile.seed) || 0, fixed: !!seedFile.fixed || !Number(seedFile.seed)}, window: seedFile.window || null, detail: seedFile.detail || '', platform});
  return {...replay, event: 'unknown', runType: 'run (its type was not recorded: an older artifact)'};   // the env here is the producer's, not the run under test
}

// What one producer run walked, in a line per suite (the run summary): how many fixed and seeded paths, which windows, places and themes.
export function pathSummary(replays = []) {
  const list = replays.filter(item => item && item.v === REPLAY_VERSION);
  const count = pick => list.reduce((out, item) => { const key = pick(item); if (key) out[key] = (out[key] || 0) + 1; return out; }, {});
  return {suites: list.length, fixed: list.filter(item => item.mode === 'fixed').length, seeded: list.filter(item => item.mode === 'seeded').length,
    windows: count(item => (item.window ? item.window.join('x') : '')), zones: count(item => item.zone), themes: count(item => item.theme), events: count(item => item.event),
    failedSteps: list.reduce((sum, item) => sum + item.trail.filter(step => step.status === 'failed').length, 0), steps: list.reduce((sum, item) => sum + item.trail.length, 0)};
}
