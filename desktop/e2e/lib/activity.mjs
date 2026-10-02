/* global document, window */
// Reading the Actions page and Recent activity the way a person sees them, plus the app's own structured run list (window.pilot.runs(), the data the UI renders).
// Used to prove the core promise of the workflows: a task that is working always shows that it is working, and always ends in a terminal state.

// One sample of everything a person could see about a running task.
export const sample = page => page.evaluate(async () => {
  const data = await window.pilot.runs();
  const panel = document.getElementById('activity-panel');
  const logText = document.getElementById('log')?.textContent || '';
  const jobs = window.__jp?.shared?.allJobs || [];
  return {
    at: Date.now(),
    running: data.running ? {kind: data.running.kind || '', step: data.running.step || '', live: !!data.running.live, where: data.running.where || 'mac', logLines: (data.running.log || []).length} : null,
    queued: (data.queued || []).length,
    newest: data.runs?.[0] ? {kind: data.runs[0].kind, ok: data.runs[0].ok, result: data.runs[0].result || data.runs[0].summary || '', live: !!data.runs[0].live} : null,
    banner: {shown: !document.getElementById('run-banner')?.hidden, title: document.getElementById('run-banner-title')?.textContent || '', step: document.getElementById('run-banner-step')?.textContent || ''},
    panelOpen: !!panel && !panel.hidden,
    panelStep: document.getElementById('activity-step')?.textContent || '',
    // What the Technical log shows: a placeholder is not a log.
    logShown: /^(Nothing to show yet|No log for this run|Starting on GitHub)/.test(logText.trim()) ? 0 : logText.split('\n').filter(Boolean).length,
    jobs: jobs.length,
    unscored: jobs.filter(job => job.fit == null || job.fit === '').length,
  };
});

// A signature of "something visibly changed": any of these moving counts as a sign of life.
export const lifeSign = s => JSON.stringify([s.running?.step, s.banner.step, s.panelStep, s.logShown, s.unscored, s.jobs, s.queued]);

// Samples every `every` ms until the run ends (nothing running and nothing queued) or `maxMs` pass. -> {samples, endedAt|null}
export async function watch(page, {every = 2000, maxMs = 360000, until = s => !s.running && s.queued === 0, onSample} = {}) {
  const samples = [];
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    const s = await sample(page).catch(() => null);
    if (s) { samples.push(s); onSample?.(s, samples); if (samples.length > 1 && until(s)) return {samples, endedAt: s.at}; }
    await page.waitForTimeout(every);
  }
  return {samples, endedAt: null};
}

// The longest stretch (ms) in which nothing a person could see changed, from the first sample that showed the task running.
export function longestSilence(samples) {
  const running = samples.filter(s => s.running);
  let longest = 0, since = running[0]?.at, last = running[0] && lifeSign(running[0]);
  for (const s of running) {
    const sign = lifeSign(s);
    if (sign !== last) { longest = Math.max(longest, s.at - since); since = s.at; last = sign; }
  }
  if (running.length) longest = Math.max(longest, running.at(-1).at - since);
  return longest;
}

// ---------- what a run may show a person ----------
// A summary line that says nothing, or says it in the machine's words: empty, "undefined", "[object Object]", or a JSON dump. -> a reason, or ''.
export function badSummary(text) {
  const line = String(text ?? '').trim();
  if (!line) return 'it is empty';
  if (/\b(undefined|null|NaN)\b|\[object Object\]/.test(line)) return `it shows a programming value ("${line.slice(0, 60)}")`;
  if (/^[{[]/.test(line)) { try { JSON.parse(line); return `it is raw JSON ("${line.slice(0, 60)}")`; } catch { /* not JSON */ } }
  if (/^\s*(Traceback \(most recent call last\)|\w*Error: |\w+\.\w+Error)/.test(line)) return `it is a stack trace ("${line.slice(0, 60)}")`;
  return '';
}

// What must never be in a log a person can read or share: a key, a token, an email address, or a path on this computer. `secrets` are the exact values to look for
// (the test's own keys); `dirs` the folders of this machine (the profile). -> the list of things found, each named without repeating the secret.
export function leaks(text, {secrets = [], dirs = []} = {}) {
  const found = [];
  const body = String(text ?? '');
  for (const secret of secrets.filter(value => value && value.length >= 8)) if (body.includes(secret)) found.push(`a saved secret (${secret.slice(0, 4)}…)`);
  if (/sk-ant-[\w-]{8,}/.test(body)) found.push('an Anthropic key');
  if (/\b(?:ntn_|secret_)[A-Za-z0-9]{12,}/.test(body)) found.push('a Notion token');
  if (/\b\d{6,}:[A-Za-z0-9_-]{30,}\b/.test(body)) found.push('a Telegram bot token');
  const email = body.match(/[\w.+-]+@(?!example\.(?:com|org)\b)[\w-]+\.[\w.-]+/);
  if (email) found.push(`an email address (${email[0].replace(/^[^@]*/, '…')})`);
  if (/(?:\/Users\/|\/home\/)[^\s/]+\/|[A-Z]:\\Users\\/.test(body)) found.push('a path in a home folder');
  for (const dir of dirs.filter(Boolean)) if (body.includes(dir)) found.push(`a path on this computer (${dir.split(/[\\/]/).slice(0, 3).join('/')}/…)`);
  return found;
}
