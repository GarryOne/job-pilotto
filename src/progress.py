"""Live progress for a long step: "⏳ Reading new jobs with AI: 12 of 26", printed at the start, then at most every few seconds and at the end.
The app shows the latest ⏳ line as the run's current step (desktop/lib/pipeline.js) and the Search runs row as its Summary
(src/notion/cron_runs.py). 7 Oct 2026: a search read 26 jobs with AI for minutes while the app said "Closed 0 job(s) not seen for 7 days".
Each line after the first also says about how long is left, from the pace so far (owner, 7 Oct 2026: "I want to have a clue when it's going
to finish. In 30 s or in 10 minutes")."""
import time


class Ticker:
    def __init__(self, label, total, every=8.0, clock=time.monotonic, out=None):
        self.label, self.total, self.every, self.clock = label, total, every, clock
        self.out = out or (lambda text: print(text, flush=True))
        self.last, self.started = None, clock()
        if total:
            self._say(0, '')

    def tick(self, done, extra=''):
        if not self.total:
            return
        if done >= self.total or self.clock() - self.last >= self.every:
            self._say(done, extra)

    def _say(self, done, extra):
        self.last = self.clock()
        self.out(f'⏳ {self.label}: {min(done, self.total)} of {self.total}{extra}{left(self.last - self.started, done, self.total)}')


def left(elapsed, done, total):
    """' · about 4 min left' from the pace so far; '' before the first item is done, and at the end."""
    if done <= 0 or done >= total:
        return ''
    seconds = elapsed / done * (total - done)
    if seconds < 60:
        return ' · under a minute left' if seconds >= 10 else ''
    return f' · about {round(seconds / 60)} min left'

