// How a run ended, in one word and a tone: the Actions page and Recent activity both use this, so they cannot disagree.
import {runWarningLines} from './run-warnings.js';

// A finished run that worked but said something (its row's Status, or a warning line in its log or report).
export const runWarned = run => !!run && !run.live && !run.waiting && !!run.ok && !run.off && (!!run.warned || runWarningLines(run).length > 0);

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
