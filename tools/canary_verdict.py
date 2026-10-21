"""Who a red stable-canary run blames: the stable build (a suite failed) or our own harness (the plan job failed, no suite ever ran on the build)."""
import json
import sys


def verdict(jobs):
    """jobs = the e2e run's jobs ([{name, conclusion}]) -> 'green' | 'stable' | 'harness'.
    A failed `plan` job (main's harness unit tests, the suite list) ran before any suite touched the stable tag: that is not the stable build failing."""
    bad = [j for j in jobs if j.get('conclusion') in ('failure', 'timed_out', 'startup_failure')]
    if not bad:
        return 'green'
    if all(j.get('name') == 'plan' for j in bad):
        return 'harness'
    return 'stable'


if __name__ == '__main__':
    print(verdict(json.load(sys.stdin).get('jobs', [])))
