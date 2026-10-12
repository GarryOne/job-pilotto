// After a write that changes a job's stage or status: patch only its own row, read the list again, never paint a read older than the write.
// Every such write in the window ends in changed() (pages/jobs.js jobsChanged): a session's Cancel, Skip, Close or "I submitted it", a row's menu,
// a board drop, an outcome on Focus. The row the action came from shows the change at once (only that exact object: a session finds its job by
// address, and may find none), then the list is read again from the store and painted from that answer.
// A read that began before the latest write is never painted: it may hold the old stage (12 Oct 2026: a 30 s job-list read started before a
// Cancel ended 8 s after it, and the cancelled job showed Applying again, its session gone: "still marked Applying but has no open session").
// Writes close together share one read again (each read is a Python run; ~10 at once slowed every read to 60 s, 7 Oct 2026).
// Guarded by: test/job-writes.test.js.
export function jobWrites({read, paint}) {
  let writes = 0, rereading = null;
  const reread = async () => {
    for (;;) {
      const at = writes;
      const fresh = await read().catch(() => null);
      if (at !== writes) continue;   // another write landed while it read: read again
      if (fresh?.jobs) paint(fresh);
      return;
    }
  };
  return {
    changed(job = null, patch = {}) {
      writes += 1;
      if (job) Object.assign(job, patch);
      if (!rereading) rereading = reread().finally(() => { rereading = null; });
      return rereading;
    },
    // Any other read of the list (start, Show more, a refresh's live reload): its answer, or null when a write landed while it ran.
    async read(options) {
      const at = writes;
      const fresh = await read(options);
      return at === writes ? fresh : null;
    },
  };
}
