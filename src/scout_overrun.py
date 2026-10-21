"""Says where the central scout is stuck when it runs past its time budget: stacks of every thread, written to the job log.
Why: 20 Oct 2026, 2 of 6 central runs were cancelled at the job's 75 minutes with an empty log, so no one could tell which check held them.
Tests: tests/test_scout_overrun.py."""

import faulthandler
import os
import sys
import threading

GRACE_S = 10 * 60   # the budget ends new checks; running ones normally finish well inside this


def arm(budget_s, grace_s=GRACE_S, file=None):
    """After budget_s + grace_s, dump every thread's stack once to `file` (stderr). Returns False when there is no budget to overrun."""
    if not budget_s:
        return False
    target = file or sys.stderr
    print(f'scout: stacks are written if the run is still going {(budget_s + grace_s) / 60:.0f} min after its start', flush=True)
    faulthandler.dump_traceback_later(budget_s + grace_s, repeat=False, file=target)
    return True


def disarm():
    """The run ended in time: no dump."""
    faulthandler.cancel_dump_traceback_later()


def leave_if_stuck():
    """Everything is saved and published: a check given up on (scout.run, CHECK_LIMIT_S) may still hold its thread, and Python waits for every thread
    before it exits, so the job would sit until its cancel. Leaves at once when one is left."""
    if threading.active_count() > 1:
        print(f'scout: {threading.active_count() - 1} check thread(s) still running after the run; leaving without them', flush=True)
        sys.stdout.flush()
        sys.stderr.flush()
        os._exit(0)
