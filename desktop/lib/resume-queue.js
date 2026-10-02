// Jobs you had started when the app last quit (pipeline queue.json) start again a little after launch. The queue is taken at LAUNCH and started later: read at
// start time, it holds what you started in this session (a Run pressed in the first 20 s), and that job ran twice (2 Oct 2026, found by the activity e2e suite).
import {e2eMs} from './e2e-timing.js';
export function scheduleResume(pipeline, storage, {cloud = false, begin, delayMs = 20 * 1000, timer = setTimeout}) {
  const jobs = pipeline.takeQueue(storage).filter(job => job.trigger !== 'schedule' && !(cloud && ['search', 'mail'].includes(job.kind)));
  timer(() => begin(jobs), delayMs);
  return jobs;
}

// The wait before the last session's jobs start again: 20 s, so the schedule's own catch-up has queued what is due. The end-to-end journey shortens it (never for a user).
export const resumeDelay = (env = process.env) => e2eMs('RESUME_MS', 20 * 1000, env);
