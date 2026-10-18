"""Jobs shown as each source is read (owner, 18 Oct 2026: "start displaying jobs to the user as quickly as possible"): a search imports
each source's jobs the moment it has them and says "Jobs so far: N new from …", the line the Jobs list reads itself again on
(desktop/renderer/pages/jobs.js LIST_CHANGED). The search's final import then keeps the early "new" status, so its counts and new-job
lines are the same as when everything was imported at the end. Tests: tests/test_jobs_per_source.py."""
from . import store


def _key(job):
    return job.get('url') or f"{job.get('company')}|{job.get('id')}"


class SoFar:
    def __init__(self, db, say=print):
        self.db, self.say, self.first = db, say, {}

    def add(self, jobs, where):
        """Import these jobs now; the first status each one got is kept for the end."""
        statuses = store.import_watch_report(self.db, {'jobs': jobs})
        for job, status in zip(jobs, statuses):
            self.first.setdefault(_key(job), status)
        new = sum(status == 'new' for status in statuses)
        if new:
            self.say(f'Jobs so far: {new} new from {where}')

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
        return [self.first.get(_key(job), status) for job, status in zip(report.get('jobs') or [], imported)]
