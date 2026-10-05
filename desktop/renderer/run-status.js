// How a run ended, in one word and a tone: the Actions page and Recent activity both use this, so they cannot disagree.
import {runWarningLines} from './run-warnings.js';

// A finished run that worked but said something (its row's Status, or a warning line in its log or report).
export const runWarned = run => !!run && !run.live && !run.waiting && !!run.ok && !run.off && (!!run.warned || runWarningLines(run).length > 0);

// The title of the toast when a run ends: a run that worked but warned is not "done" with a green check, the detail pane says "Completed with warnings" (#276).
export function doneTitle(name, run) {
  if (!run?.ok || run?.off) return `⚠️ ${name} had problems`;
  return runWarned(run) ? `⚠️ ${name} done with warnings` : `✅ ${name} done`;
}

// What a failed run says in the box above its log, in its own words (#290, 5 Oct 2026: a Gmail check whose Google sign-in was revoked was "Failed" in the pill and "Completed with
// warnings" in the box, with no reason and no way out). The reason is the run's `problem`; a fix the app can open is named next to it.
export const PROBLEM_FIXES = [[/Google sign-in/i, 'Connect Google again', 'settings'], [/Claude Code is not ready/i, 'Open AI settings', 'settings'], [/Telegram/i, 'Open Telegram settings', 'settings']];
export function failureHead(run) {
  if (!run || run.live || run.waiting || (run.ok && !run.off)) return null;
  const problem = String(run.problem || '').trim();
  const fix = PROBLEM_FIXES.find(([pattern]) => pattern.test(problem));
  const lead = /^not (checked|delivered):\s*/i.exec(problem)?.[1]?.toLowerCase();   // the title says it; the sentence under it is only the reason
  const reason = problem.replace(/^not (?:checked|delivered):\s*/i, '');
  return {problem, title: !problem ? 'Had problems' : lead === 'delivered' ? 'Not delivered' : 'Not checked',
    summary: problem ? `${reason.replace(/^./, c => c.toUpperCase())}.` : 'The run failed: its log shows where it stopped.', fix: fix ? {label: fix[1], view: fix[2]} : null};
}

// One checklist step of a search: 'done', 'now', 'todo', 'warn' (the step a warned run stopped at) or 'fail' (the step a failed run stopped at).
// `at` is the index of the last step the log reached; a failed run's steps after it never ran, so they stay 'todo'.
export function phaseStatus(run, i, at) {
  const live = !!run?.live;
  if (i === at && !live && runWarned(run)) return 'warn';
  if (i === at && !live && !run?.waiting && (!run?.ok || run?.off)) return 'fail';
  return i < at || (i === at && !live) ? 'done' : i === at ? 'now' : 'todo';
}

// A run's status pill: running, queued, failed, completed with warnings, completed. [label, tone, options]
export function runStatus(run, warned) {
  if (run.live) return ['Running', 'info', {dot: true}];
  if (run.waiting) return ['Queued', 'neutral'];
  if (!run.ok || run.off) return ['Failed', 'bad'];
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
