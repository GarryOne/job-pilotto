"""Every workflow job that runs a release script can do all of it: tools/beta-approve.sh, tools/release-stable.sh and
tools/sync_release_labels.py rewrite the pinned Release channels issue, so the job needs `issues: write`. The release gate's
promote job had `issues: read`: alpha.254 was approved, then the label sync failed (3 Oct 2026)."""
import re
import unittest
from pathlib import Path

WORKFLOWS = Path(__file__).resolve().parents[1] / '.github' / 'workflows'
RELEASE_SCRIPTS = re.compile(r'beta-approve\.sh|release-stable\.sh|sync_release_labels\.py')


def permissions(block):
    """{scope: level} of the first `permissions:` mapping in `block` (indented lines under it)."""
    match = re.search(r'^( *)permissions:[ \t]*\n((?:\1  +[\w-]+: *[\w-]+.*\n)+)', block, re.M)
    return dict(re.findall(r'^ +([\w-]+): *([\w-]+)', match.group(2), re.M)) if match else None


def jobs(text):
    """(name, text) of each job: the two-space keys under `jobs:`."""
    body = text.split('\njobs:\n', 1)[1]
    parts = re.split(r'^  ([\w-]+):[ \t]*(?:#.*)?\n', body, flags=re.M)
    return list(zip(parts[1::2], parts[2::2]))


class ReleaseJobsMayWriteIssues(unittest.TestCase):
    def test_every_job_that_runs_a_release_script_has_issues_write(self):
        checked = []
        for path in sorted(WORKFLOWS.glob('*.yml')):
            text = path.read_text()
            if '\njobs:\n' not in text:
                continue
            top = permissions(text.split('\njobs:\n', 1)[0])
            for name, job in jobs(text):
                if not RELEASE_SCRIPTS.search(job) or re.search(r"DRY_RUN: *'1'", job):   # a dry run changes nothing (release-stable.sh exits first)
                    continue
                granted = permissions(job) if permissions(job) is not None else top
                checked.append(f'{path.name}:{name}')
                self.assertEqual((granted or {}).get('issues'), 'write', f'{path.name} job {name} runs a release script without issues: write')
        self.assertIn('e2e.yml:promote', checked)   # the parser found the jobs (a broken split would check nothing)


if __name__ == '__main__':
    unittest.main()
