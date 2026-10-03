// What went wrong in the window over a WHOLE suite, not only during a probe's click: an uncaught exception or an unhandled promise rejection, a console.error,
// one of the app's own files failing to load. Each distinct one becomes a finding (at most a few per suite), so a renderer error on a path no check looks at
// still reaches the issue list. Collected across relaunches (lib/app.mjs records into `journey`).
export const journey = {pageErrors: [], consoleErrors: [], failedLoads: []};
export const resetJourney = () => { journey.pageErrors.length = 0; journey.consoleErrors.length = 0; journey.failedLoads.length = 0; };

// What a suite that breaks the AI on purpose expects to see in the console (the app logging the refusals it then shows in words).
const EXPECTED_AI = /\b(?:429|500|529|401|overloaded|rate.?limit|credit balance|usage limits?|spend(?:ing)? limit|anthropic|AI service)\b/i;
// Noise that is not the app's: a page outside the app, the dev tools, an aborted load while a page is replaced.
const NOISE = /DevTools|Electron Security Warning|ERR_ABORTED|net::ERR_INTERNET_DISCONNECTED/;
const firstLine = text => String(text || '').split('\n')[0].trim().slice(0, 200);
const signature = text => (/^(\w*Error\b|Uncaught \(in promise\)|Uncaught\b)/.exec(firstLine(text))?.[1] || 'error').replace(/\s+/g, '-').replace(/[()]/g, '');

export function journeyFindings(store, {suite, expectsFailures = false, max = 3} = {}) {
  const view = `${suite}-journey`, out = [], seen = new Set();
  const add = (kind, severity, sig, text) => {
    const key = `${kind}|${firstLine(text)}`;
    if (seen.has(key) || out.filter(item => item.kind === kind).length >= max) return;
    seen.add(key);
    out.push({view, severity, kind, detail: `${sig}: "${firstLine(text)}"`});
  };
  for (const text of store.pageErrors) if (!NOISE.test(text)) add('console-error', 'warning', `window threw ${signature(text)}`, text);
  for (const text of store.consoleErrors) if (!NOISE.test(text) && !(expectsFailures && EXPECTED_AI.test(text))) add('console-error', 'warning', `console ${signature(text)}`, text);
  for (const url of store.failedLoads) add('broken-resource', 'warning', 'failed to load', url);
  return out;
}
