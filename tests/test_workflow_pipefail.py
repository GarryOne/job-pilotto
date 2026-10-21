"""A workflow step whose script pipes a program into tee/cat/a group must fail when the program fails: GitHub's default `bash -e {0}` has no pipefail, so
`node plan-run.mjs | cat >> $GITHUB_OUTPUT` crashed with exit 0 and every release gate skipped its E2E and Release jobs for three days (18-21 Oct 2026), and
`tools/release-checks.sh | tee` could never block a release. The step says `set -o pipefail`, uses PIPESTATUS, or names a pipefail shell."""
import re
import unittest
from pathlib import Path

WORKFLOWS = Path(__file__).resolve().parent.parent / '.github/workflows'
# A program of ours (node, python, a tools/ script) piped on into a sink that hides its exit code.
PIPED = re.compile(r'(?<![\w/.-])(?:node|python3?|bash|tools/[\w.-]+|npx)\s[^|;&\n]*\|\s*(?:tee|cat|\{)')
SAFE = re.compile(r'pipefail|PIPESTATUS')
# Steps that only print a summary or a log and decide nothing: their exit code never gates a release or a verdict.
SUMMARY_ONLY = {
    ('fix-verdicts.yml', 'verify-plan.mjs'), ('record-sites.yml', 'pool-ci-summary.mjs'), ('record-sites.yml', 'pool-moves.mjs'),
    ('record-sites.yml', 'discovery-pick.mjs'), ('hosted-probe.yml', 'wrangler'), ('pr-check-scorecard.yml', 'pr-check-scorecard.mjs'),
    ('schedule-watchdog.yml', 'watchdog.mjs'), ('replay-refill.yml', 'refill-merge.mjs'), ('replay-refill.yml', 'refill-group.mjs'),
    ('replay-refill.yml', 'records-publish.mjs'), ('record-sites.yml', 'record-sites.mjs'), ('fix-verdicts.yml', 'verify-row.mjs'), ('hosted-probe.yml', ''), ('replay-refill.yml', 'refill-yellow.mjs'), ('site-replays.yml', 'replay-late.mjs'),
}


def steps(text):
    for chunk in re.split(r'(?m)^      - ', text)[1:]:
        yield chunk


class WorkflowPipefail(unittest.TestCase):
    def test_gate_steps_that_pipe_a_program_keep_its_exit_code(self):
        bad = []
        for path in sorted(WORKFLOWS.glob('*.yml')):
            for step in steps(path.read_text()):
                if 'run:' not in step or SAFE.search(step):
                    continue
                for line in step.splitlines():
                    if line.lstrip().startswith('#') or not PIPED.search(line):
                        continue
                    program = re.search(r'(?:node|python3?|bash|npx)\s+(?:[\w@.=-]+\s+)*?([\w./-]+\.mjs|wrangler)|tools/[\w.-]+', line)
                    name = (program.group(1) or program.group(0)).split('/')[-1] if program else ''
                    if (path.name, name) not in SUMMARY_ONLY:
                        bad.append(f'{path.name}: {line.strip()[:120]}')
        self.assertEqual(bad, [], 'add `set -o pipefail` to the step (or PIPESTATUS), or list a summary-only step in SUMMARY_ONLY')


if __name__ == '__main__':
    unittest.main()
