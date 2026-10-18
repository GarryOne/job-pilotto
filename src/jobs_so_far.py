"""Jobs shown as each source is read (owner, 18 Oct 2026: "start displaying jobs to the user as quickly as possible"): a search imports
each source's jobs the moment it has them and says "Jobs so far: N new from …", the line the Jobs list reads itself again on
(desktop/renderer/pages/jobs.js LIST_CHANGED). The search's final import then keeps the early "new" status, so its counts and new-job
lines are the same as when everything was imported at the end. Tests: tests/test_jobs_per_source.py.
The line is said at once for a search's first new jobs, then at most once every EVERY seconds with the sum since the last one (a search
reads ~200 employer sites one by one: one line each flooded the activity log); statuses() says what is left.
"""
import time

from . import store

EVERY = 5


def _key(job):
    return job.get('url') or f"{job.get('company')}|{job.get('id')}"


class SoFar:
    def __init__(self, db, say=print, every=EVERY, clock=time.monotonic):
        self.db, self.say, self.first = db, say, {}
        self.every, self.clock, self.said_at, self.pending = every, clock, None, {}

    def add(self, jobs, where):
        """Import these jobs now; the first status each one got is kept for the end."""
        statuses = store.import_watch_report(self.db, {'jobs': jobs})
        for job, status in zip(jobs, statuses):
            self.first.setdefault(_key(job), status)
        new = sum(status == 'new' for status in statuses)
        if new:
            self.pending[where] = self.pending.get(where, 0) + new
            if self.said_at is None or self.clock() - self.said_at >= self.every:
                self.flush()

    def flush(self):
        """Say the new jobs not yet said, one line per source kind, the newest last."""
        for where, new in self.pending.items():
            self.say(f'Jobs so far: {new} new from {where}')
        if self.pending:
            self.said_at = self.clock()
        self.pending = {}

    def listener(self, where):
        """on_jobs for feeds.scan / aggregators.scan; a failure here never stops the search (the final import does it all)."""
        def on_jobs(jobs):
            try:
                self.add(jobs, where)
            except Exception as error:  # noqa: BLE001
                self.say(f'Warning: jobs not shown early: {type(error).__name__}: {error}')
        return on_jobs

    def statuses(self, report, imported):
        """The final import's statuses, with each job shown early keeping the status it got then (a second import says "seen")."""
        self.flush()
        return [self.first.get(_key(job), status) for job, status in zip(report.get('jobs') or [], imported)]
