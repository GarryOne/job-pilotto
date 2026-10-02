// How a run ended, in one word and a tone: the Actions page and Recent activity both use this, so they cannot disagree.
import {runWarningLines} from './run-warnings.js';

// A finished run that worked but said something (its row's Status, or a warning line in its log or report).
export const runWarned = run => !!run && !run.live && !run.waiting && !!run.ok && !run.off && (!!run.warned || runWarningLines(run).length > 0);

// A run's status pill: running, queued, failed, completed with warnings, completed. [label, tone, options]
export function runStatus(run, warned) {
  if (run.live) return ['Running', 'info', {dot: true}];
  if (run.waiting) return ['Queued', 'neutral'];
  if (!run.ok || run.off) return ['Failed', 'bad'];
  return warned ? ['With warnings', 'warn'] : ['Completed', 'good'];
}
