// How a run ended, in one word and a tone: the Actions page and Recent activity both use this, so they cannot disagree.
import {AI_BUSY, isSpendingLimit, runWarningLines} from './run-warnings.js';

// A finished run that worked but said something (its row's Status, or a warning line in its log or report).
// A run that made only part of what it set out to (Tailor CVs: "3 of 5 tailored · 2 failed"): its card says which; its pill says With warnings.
export const partialResult = run => { const m = /(\d+) of (\d+) (?:tailored|drafted)/.exec(String(run?.message || '')); return !!m && Number(m[1]) < Number(m[2]); };
export const runWarned = run => !!run && !run.live && !run.waiting && !!run.ok && !run.off && (!!run.warned || runWarningLines(run).length > 0 || !!deliveryHead(run) || partialResult(run));

// The title of the toast when a run ends: a run that worked but warned is not "done" with a green check, the detail pane says "Completed with warnings" (#276).
export function doneTitle(name, run) {
  if (!run?.ok || run?.off) return `⚠️ ${name} had problems`;
  return runWarned(run) ? `⚠️ ${name} done with warnings` : `✅ ${name} done`;
}

// What a failed run says in the box above its log, in its own words (#290, 5 Oct 2026: a Gmail check whose Google sign-in was revoked was "Failed" in the pill and "Completed with
// warnings" in the box, with no reason and no way out). The reason is the run's `problem`; a fix the app can open is named next to it.
export const PROBLEM_FIXES = [[/Google sign-in/i, 'Reconnect Google', 'settings'], [/Claude Code is not ready/i, 'Open AI settings', 'settings'], [/Telegram/i, 'Open Telegram settings', 'settings']];
// A run the AI provider stopped (usage/spending limit, or rate-limited) — the engine exits with an error, so the run has no
// problem line and read "Had problems" over a raw log. It says what happened, what it means and the one fix (the owner's
// mockup, 6 Oct 2026): a variant of the failure box beside the others, not a replacement.
const AI_STOPPED_WHAT = {mail: 'Email processing', search: 'Scoring', insight: 'The insight', weekly: 'The report', kit: 'The application kit',
  interview: 'The interview review', review: 'The review'};
// Which limit, from the error itself and who is billed (owner, 6 Oct 2026: credits, a spend limit, a plan's limit and a rate limit all read
// "Increase your limit"): its words and the page that fixes it. A cause not recognised keeps the neutral words.
const LIMIT_KINDS = [
  {test: (line) => /credit balance/i.test(line), why: 'API credits are exhausted.', hint: 'Add credits, then run it again.',
    fix: {label: 'Manage API billing', url: 'https://console.anthropic.com/settings/billing'}},
  {test: (line, run) => run.billing === 'Claude subscription' || /Claude Code|usage window|your plan|resets? at/i.test(line), why: 'Your plan’s usage limit was reached.',
    hint: line => { const at = /resets? (?:at|in) ([^.;)]+)/i.exec(line); return at ? `It resets at ${at[1].trim()}; run it again then.` : 'Run it again once your plan’s usage resets.'; },
    fix: {label: 'View plan usage', url: 'https://claude.ai/settings/usage'}},
  {test: (line) => /specified API usage limits?|spending limit|spend limit/i.test(line), why: 'Your API spend limit was reached.', hint: 'Raise the limit, then run it again.',
    fix: {label: 'Manage API limits', url: 'https://console.anthropic.com/settings/limits'}},
];
export function aiLimitHead(run, name = 'The run') {
  if (!run || run.live || run.waiting || (run.ok && !run.off)) return null;
  const lines = [run.problem, run.result, ...(run.log || []), ...(run.report || [])].filter(Boolean).map(String);
  const hit = lines.find(line => isSpendingLimit(line)) || lines.find(line => AI_BUSY.test(line));
  if (!hit) return null;
  const what = AI_STOPPED_WHAT[run.kind] || 'The run';
  const title = `${name} couldn’t finish`;
  if (!isSpendingLimit(hit)) return {problem: hit, title, summary: `Too many requests to the AI provider. ${what} could not complete.`, hint: 'Try again shortly: wait a few minutes, then run it again.', fix: null};
  const kind = LIMIT_KINDS.find(one => one.test(hit, run));
  if (kind) return {problem: hit, title, summary: `${kind.why} ${what} could not complete.`, hint: typeof kind.hint === 'function' ? kind.hint(hit) : kind.hint, fix: kind.fix};
  return {problem: hit, title, summary: `The AI provider’s usage limit was reached. ${what} could not complete.`,
    hint: `Increase your limit, then run the ${name === 'Gmail check' ? 'check' : name === 'Refresh jobs' ? 'refresh' : 'task'} again.`,
    fix: {label: 'Manage AI limit', url: run.billing === 'Claude subscription' ? 'https://claude.ai/settings/usage' : 'https://console.anthropic.com/settings/limits'}};
}
// A run the app's watchdog stopped (lib/pipeline.js stoppedReason): what happened, the step it was on in plain words, and the way
// out, with the log folded since the box says it (the owner's targeted fix #4, 6 Oct 2026: 110 log lines hid the reason).
const STOPPED = /Stopped by Job Pilotto: (no output for (\d+) (min|s)|still running after (\d+) min)\b.*?(?:The last thing it did: (.+))?$/;
const DOING = [[/^Descriptions:/, 'fetching job descriptions'], [/^Scor(?:ed|ing) /, 'scoring new jobs'], [/^Enriched /, 'reading new jobs'],
  [/^(?:Checking employer career pages|Checked: )/, 'checking employer career pages'], [/^(?:Searching job boards|Job boards:)/, 'searching the job boards']];
const unit = (n, word) => `${n} ${word}${n === '1' ? '' : 's'}`;
export function stoppedHead(run) {
  if (!run || run.live || run.waiting || (run.ok && !run.off)) return null;
  const line = [run.problem, run.summary, run.result, ...[...(run.log || [])].reverse()].filter(Boolean).map(String).find(text => STOPPED.test(text));
  if (!line) return null;
  const [, stopped, quiet, scale, total, lastLine = ''] = STOPPED.exec(line);
  const last = lastLine.trim() === 'nothing yet' ? '' : lastLine.trim();
  const doing = DOING.find(([pattern]) => pattern.test(last))?.[1] || '';
  const search = run.kind === 'search' || !run.kind;
  return {problem: line, stopped, last, doing,
    title: quiet ? `Stopped after ${unit(quiet, scale === 'min' ? 'minute' : 'second')} without output` : `Stopped after running ${unit(total, 'minute')}`,
    summary: `The run stopped responding${doing ? ` while ${doing}` : ''}. ${search ? 'The search did not finish: final results are unavailable.' : 'It did not finish.'}`,
    hint: 'Run it again; if it keeps stopping, check your AI key or plan in Settings.', fix: {label: 'Run again', rerun: true}};
}
// A run that did its work but whose Telegram message did not arrive (lib/run-result.js deliveryProblem, or the engine's own
// "Warning: Telegram refused the digest: …"): Completed with warnings, its steps ticked, then this box under them with the paper
// plane and the way to Telegram settings (the owner's targeted fix #5, 6 Oct 2026: a delivery failure read as a failed search).
const NOT_DELIVERED = /^not delivered:\s*/i;
const TELEGRAM_SAID = /Telegram (?:refused the digest|did not accept the digest|could not be reached|is limiting the bot)[^\n]*/;
export function deliveryHead(run) {
  if (!run || run.live || run.waiting || !run.ok || run.off) return null;
  const lines = [...(run.log || []), ...(run.report || [])].map(String).filter(line => TELEGRAM_SAID.test(line));
  const flagged = NOT_DELIVERED.test(run.problem || '') ? String(run.problem).replace(NOT_DELIVERED, '') : '';
  if (!lines.length && !flagged) return null;
  const reason = lines.length ? TELEGRAM_SAID.exec(lines.at(-1))[0] : `${flagged.replace(/^./, c => c.toUpperCase())}.`;
  const what = run.kind === 'search' || !run.kind ? 'search' : 'run';
  return {problem: reason, delivery: true, lines, icon: 'send', title: 'Telegram message not delivered',
    summary: `The ${what} completed, but its Telegram message was not sent.`, hint: reason, fix: {label: 'Open Telegram settings', view: 'settings'}};
}

// A Gmail check with Gmail not connected: nothing was checked, the box says so and connects it (the owner's fix #6, 6 Oct 2026).
export function notConnectedHead(run, connectedNow = null) {
  if (!run?.off || run.live || run.waiting) return null;
  // Connected since: the run stays as it was (history), without a button to connect what already is.
  if (connectedNow === true) return {problem: 'Gmail was not connected', title: 'Gmail was not connected', icon: 'mail', short: 'Gmail not connected',
    summary: 'This check ran before Gmail was connected, so nothing was checked.', hint: 'Gmail is connected now: the next check reads your emails.', fix: null};
  return {problem: 'Gmail is not connected', title: 'Gmail is not connected', icon: 'mail', short: 'Gmail not connected',
    summary: 'Connect your Google account before checking for emails and calendar updates.', fix: {label: 'Connect Gmail', view: 'settings'}};
}
// A run that ended while it waited for another Job Pilotto run (lib/pipeline.js run_lock): it never started its work (fix #10).
const WAITED = /Another Job Pilotto (?:search|run) is running[^\n]*waiting for it/i;
const DOING_NOUN = {tailor: 'tailoring', visits: 'reading sites', kits: 'preparing kits', search: 'the search', scout: 'finding employers', weekly: 'the analysis',
  insight: 'the insight', mail: 'the Gmail check', review: 'the review', interview: 'the interview review'};
export function waitedHead(run) {
  if (!run || run.live || run.waiting || run.ok || run.problem) return null;
  const line = (run.log || []).map(String).find(text => WAITED.test(text));
  if (!line) return null;
  const title = `Couldn’t start ${DOING_NOUN[run.kind] || 'the run'}`;
  return {problem: line, title, short: title, icon: 'clock', quiet: true,
    summary: 'The last recorded step was waiting for another Job Pilotto run. This attempt ended without a result.',
    hint: 'Try again when the other run has finished.', fix: {label: 'Try again', rerun: true}};
}

export function failureHead(run, name = '') {
  if (!run || run.live || run.waiting || (run.ok && !run.off)) return null;
  // Job Pilotto was closed while it ran (lib/pipeline.js takeQueue): not an error, and its log is kept (owner, 7 Oct 2026: it read "stopped unexpectedly").
  if (run.interrupted) {
    return {problem: 'interrupted', quiet: true, short: 'Interrupted', viewLog: true, title: `${name || 'The run'} was interrupted`,
      summary: 'Job Pilotto was closed while this ran. What it saved is kept; run it again to continue.', fix: {label: 'Run again', rerun: true}};
  }
  const problem = String(run.problem || '').trim();
  // No reason recognised: say it stopped unexpectedly, offer to run it again and the log (the owner's fix #7, 6 Oct 2026: "Had problems" over a raw log).
  if (!problem) {
    return {problem: 'unexpected', unexpected: true, quiet: true, short: 'Unexpected error', viewLog: true,
      title: `${run.kind === 'search' ? 'The job search' : name || 'The run'} stopped unexpectedly`,
      summary: 'An unexpected error interrupted this run. No final result was recorded.', fix: {label: 'Run again', rerun: true}};
  }
  const fix = PROBLEM_FIXES.find(([pattern]) => pattern.test(problem));
  const lead = /^not (checked|delivered):\s*/i.exec(problem)?.[1]?.toLowerCase();   // the title says it; the sentence under it is only the reason
  const reason = problem.replace(/^not (?:checked|delivered):\s*/i, '');
  return {problem, title: lead === 'delivered' ? 'Not delivered' : 'Not checked',
    summary: `${reason.replace(/^./, c => c.toUpperCase())}.`, fix: fix ? {label: fix[1], view: fix[2]} : null};
}

// What a failed run says about itself when no reason was recognised (#301, 5 Oct 2026: a Jobs check that was Failed read "1 new job", like a success, because the result a Notion row
// carries won). It says it failed first, and keeps what the run did report.
export function failedOutcome(run) {
  if (!run || run.live || run.waiting || (run.ok && !run.off)) return null;
  const said = String(run.result || '').trim();
  return said ? `had problems · ${said}` : null;
}

// One checklist step of a search: 'done', 'now', 'todo', 'warn' (the step a warned run stopped at) or 'fail' (the step a failed run stopped at).
// `at` is the index of the last step the log reached; a failed run's steps after it never ran, so they stay 'todo'.
export function phaseStatus(run, i, at) {
  const live = !!run?.live;
  if (i === at && !live && runWarned(run) && !deliveryHead(run)) return 'warn';   // a message not delivered is not a step that went wrong
  if (i === at && !live && !run?.waiting && (!run?.ok || run?.off)) return 'fail';
  return i < at || (i === at && !live) ? 'done' : i === at ? 'now' : 'todo';
}

// A run's status pill: running, queued, failed, completed with warnings, completed. [label, tone, options]
export function runStatus(run, warned) {
  if (run.live) return ['Running', 'info', {dot: true}];
  if (run.waiting) return ['Queued', 'neutral'];
  if (run.off) return ['Not checked', 'warn'];   // nothing was checked: not a failure, a connection to make
  if (run.interrupted) return ['Interrupted', 'warn'];   // the app was closed while it ran (lib/pipeline.js takeQueue)
  if (run.stopped === 'you') return ['Stopped by you', 'neutral'];   // Stop on Actions or Recent activity: not a failure
  if (!run.ok) return stoppedHead(run) ? ['Stopped', 'bad'] : ['Failed', 'bad'];
  return warned ? ['With warnings', 'warn'] : ['Completed', 'good'];
}

// The dot of the bottom status bar. It must describe the SAME run as the words beside it (the last jobs check, else the last Gmail check): the newest run of any kind
// made a Gmail check that was not connected turn the dot red beside "Last jobs check · nothing new" (UI loop #59). A run that worked but warned is amber.
export function barState(running, shown) {
  if (running) return 'busy';
  if (!shown) return 'idle';
  if (!shown.ok || shown.off) return 'error';
  return runWarned(shown) ? 'warn' : 'ok';
}

// How far a running task is, from its live step when it counts ("Scout: checked 33 of 91: EF", "Reading employer job sites: 1,200 of 2,024"):
// the progress meter above the Technical log (pages/activity.js runProgress). null when the step does not count.
export function stepCount(step = '') {
  const m = /(\d[\d,]*) of (\d[\d,]*)/.exec(String(step));
  const [done, total] = m ? [m[1], m[2]].map(n => Number(n.replace(/,/g, ''))) : [0, 0];
  return total > 0 && done <= total ? {done, total, percent: Math.round(done / total * 100)} : null;
}
