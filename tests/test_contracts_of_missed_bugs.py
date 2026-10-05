"""Contract tests for bugs the Finder missed and only had an idea for (the Notion Bug Tracker's "e2e test idea", 5 Oct 2026): each one fails on the old code.

  - Scout: registering a Haufe Umantis feed would crash because the type had no board link: every fetcher type has one.
  - Beta approval: the label sync failed because the promote job could not write issues: every job that runs the release scripts says `issues: write`.
"""
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from src import scout  # noqa: E402
from src.sources import ats  # noqa: E402

WORKFLOWS = ROOT / '.github' / 'workflows'
RELEASE_SCRIPTS = re.compile(r'beta-approve\.sh|release-stable\.sh|sync_release_labels\.py')
DRY_RUN = re.compile(r"DRY_RUN\s*[:=]\s*['\"]?1")   # release-stable.sh exits before it touches an issue (tools/release-stable.sh line 63)


def jobs_of(text):
    """(workflow-level text, {job name: its text}) by the file's own indentation: no YAML library is needed or installed."""
    head, _, body = text.partition('\njobs:\n')
    parts = re.split(r'^  ([A-Za-z0-9_-]+):\s*$', body, flags=re.M)
    return head, {parts[i]: parts[i + 1] for i in range(1, len(parts) - 1, 2)}


def writes_issues(job, head):
    """A job's own permissions block replaces the workflow's; without one the workflow's applies."""
    own = re.search(r'^    permissions:\s*\n((?:      .*\n)+)', job + '\n', re.M)
    block = own.group(1) if own else (re.search(r'^permissions:\s*\n((?:  .*\n)+)', head + '\n', re.M) or [None, ''])[1]
    return bool(re.search(r'^\s+issues:\s*write\b', block, re.M))


class ScoutBoardTests(unittest.TestCase):
    def test_every_fetcher_type_has_a_board_link(self):
        for system in ats.FETCHERS:
            try:
                scout.board_url(system, 'tenant.wd3.site')
            except KeyError:
                self.fail(f'scout.board_url has no entry for the {system!r} fetcher: registering one would crash the scout')
            except Exception:  # noqa: BLE001  a slug this test cannot decode (careers) is not a missing entry
                pass


class ReleaseWorkflowPermissionTests(unittest.TestCase):
    def test_every_job_that_runs_the_release_scripts_can_write_issues(self):
        found = 0
        for path in sorted(WORKFLOWS.glob('*.yml')):
            head, jobs = jobs_of(path.read_text())
            for name, job in jobs.items():
                if RELEASE_SCRIPTS.search(job) and not DRY_RUN.search(job):
                    found += 1
                    self.assertTrue(writes_issues(job, head), f'{path.name} job {name!r} runs a release script (it syncs labels on issues) without `issues: write`')
        self.assertGreater(found, 0, 'no job runs the release scripts: the pattern in this test is out of date')

    def test_the_check_itself_sees_a_missing_permission(self):
        text = "name: x\npermissions:\n  contents: read\njobs:\n  promote:\n    runs-on: ubuntu-latest\n    permissions:\n      contents: write\n    steps:\n      - run: tools/beta-approve.sh\n"
        head, jobs = jobs_of(text)
        self.assertFalse(writes_issues(jobs['promote'], head))
        fixed = text.replace('      contents: write\n', '      contents: write\n      issues: write\n')
        head, jobs = jobs_of(fixed)
        self.assertTrue(writes_issues(jobs['promote'], head))


if __name__ == '__main__':
    unittest.main()
