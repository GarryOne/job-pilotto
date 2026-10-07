// A line of a crash: the traceback's first line, or the exception line (KeyboardInterrupt, BrokenPipeError: …). Never a run's step, wherever the
// step is read: the engine's live output (lib/pipeline.js) or a running row's Summary in Notion (lib/run-history.js); src/notion/cron_runs.py has the same rule.
export const CRASH_LINE = /^(?:Traceback \(most recent call last\)|(?:[\w.]+\.)?[A-Z]\w*(?:Error|Exception|Exit|Interrupt)\b)/;
