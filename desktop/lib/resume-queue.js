// Jobs you had started when the app last quit (pipeline queue.json) start again a little after launch. The queue is taken at LAUNCH and started later: read at
// start time, it holds what you started in this session (a Run pressed in the first 20 s), and that job ran twice (2 Oct 2026, found by the activity e2e suite).
export function scheduleResume(pipeline, storage, {cloud = false, begin, delayMs = 20 * 1000, timer = setTimeout}) {
  const jobs = pipeline.takeQueue(storage).filter(job => job.trigger !== 'schedule' && !(cloud && ['search', 'mail'].includes(job.kind)));
  timer(() => begin(jobs), delayMs);
  return jobs;
}
