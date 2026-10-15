"""Which CI workflows a pull request starts: GitHub's `on: pull_request: paths:` alone decides (owner, 14 Oct 2026: "drop your shared pick logic, rely fully on gh
workflow paths"; a PR that changed only a recorded case ran the harness tests, a PR that changed the pick ran every job). Pins the class: no required check in a
workflow paths can skip (it would never report and block the PR), no step asks a pick, main still runs every suite on each push, and the real PR shapes."""
import re
import shlex
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKFLOWS = ROOT / '.github/workflows'


def on_block(name):
    return (WORKFLOWS / name).read_text().split('\njobs:')[0]


def pr_paths(name):
    """-> the patterns of a workflow's `pull_request: paths:`, or None (no filter)."""
    on = on_block(name)
    pr = re.search(r'(?ms)^  pull_request:.*?(?=^  \w|\Z)', on)
    if not pr or '    paths:' not in pr.group(0):
        return None
    return re.findall(r"(?m)^      - '([^']+)'", pr.group(0).split('    paths:', 1)[1])


def starts(name, files):
    """Does a pull request changing these files start this workflow? GitHub's rule: per file, the last pattern that matches wins; `!` excludes."""
    patterns = pr_paths(name)
    if patterns is None:
        return True
    def regex(glob):
        return re.compile('^' + re.escape(glob).replace(r'\*\*', '\0').replace(r'\*', '[^/]*').replace('\0', '.*') + '$')
    rules = [(p.startswith('!'), regex(p.lstrip('!'))) for p in patterns]
    def takes(file):
        verdict = False
        for negated, rule in rules:
            if rule.match(file):
                verdict = not negated
        return verdict
    return any(takes(f) for f in files)


def pr_workflows():
    return sorted(p.name for p in WORKFLOWS.glob('*.yml') if re.search(r'(?m)^  pull_request:', on_block(p.name)))


def required():
    text = (ROOT / 'tools/pr-settings.sh').read_text()
    return shlex.split(re.search(r"^checks='(.*)'$", text, re.M).group(1))


class TheClass(unittest.TestCase):
    def test_every_required_check_is_a_job_of_a_workflow_with_no_paths(self):
        checks = required()
        self.assertEqual(checks, ['All checks passed'], 'one required job (15 Oct 2026): four jobs took four runner slots per PR')
        gate = (WORKFLOWS / 'pr-gate.yml').read_text()
        self.assertIsNone(pr_paths('pr-gate.yml'), 'the required checks start on every pull request')
        for check in checks:
            self.assertRegex(gate, rf'(?m)^    name: {re.escape(check)}$', check)
        for name in pr_workflows():
            if pr_paths(name) is not None:
                text = (WORKFLOWS / name).read_text()
                self.assertEqual([c for c in checks if re.search(rf'(?m)^    name: {re.escape(c)}', text)], [], f'{name}: a required check in a workflow paths can skip')

    def test_no_workflow_asks_a_pick(self):
        for path in WORKFLOWS.glob('*.yml'):
            text = path.read_text()
            self.assertNotIn('ci-needed', text, path.name)
            self.assertNotIn('affected-jobs', text, path.name)
        for name in pr_workflows():
            self.assertNotRegex((WORKFLOWS / name).read_text(), r'git diff --name-only[^\n]*\|\s*grep', f'{name}: a second list of paths')
        self.assertFalse((ROOT / 'tools/ci-needed.sh').exists())
        self.assertFalse((ROOT / 'tools/affected-jobs.py').exists())

    def test_a_suite_starts_on_every_file_its_tests_read(self):
        # 14 Oct 2026: worker tests read extension/ files, but tests-worker.yml had no extension/** path; #731 changed extension/combo-click.js,
        # its worker test never ran on the PR, and main went red. Every '../..' file a suite's tests name must start that suite.
        for area in ('worker', 'site', 'desktop'):
            missing = set()
            for test in (ROOT / area / 'test').rglob('*'):
                if test.suffix not in ('.js', '.mjs') or 'node_modules' in test.parts:
                    continue
                for ref in re.findall(r"""['"`]((?:\.\./)+[\w.-][^'"`$]*)['"`]""", test.read_text(errors='ignore')):
                    for base in (test.parent, ROOT / area / 'test'):
                        target = (base / ref).resolve()
                        if target.exists() and ROOT in target.parents:
                            break
                    else:
                        continue
                    rel = target.relative_to(ROOT).as_posix()
                    probe = f'{rel}/x.js' if target.is_dir() else rel
                    if not rel.startswith(f'{area}/') and not starts(f'tests-{area}.yml', [probe]):
                        missing.add(rel)
            self.assertEqual(sorted(missing), [], f'tests-{area}.yml: files its tests read but its paths never start on')

    def test_ship_waits_for_every_check_the_pr_started(self):
        # With one required check, a "green" that read only them would hand the owner a PR whose suites still run.
        self.assertNotIn('--required', (ROOT / 'tools/ship-pr.sh').read_text())

    def test_main_runs_every_suite_on_each_push(self):
        build = (WORKFLOWS / 'build.yml').read_text()
        self.assertNotIn('pull_request', on_block('build.yml'), 'a pull request runs each area by itself')
        for area in ('python', 'worker', 'site', 'desktop', 'desktop-windows'):
            self.assertIn(f'uses: ./.github/workflows/tests-{area}.yml', build, area)
            self.assertIn('workflow_call:', on_block(f'tests-{area}.yml'), area)
        for name in ('page-cases.yml', 'control-tests.yml'):
            push = on_block(name).split('\n  push:', 1)[1].split('\n  ', 1)[0]
            self.assertNotIn('paths', push, f'{name}: main replays everything')


class TheShapes(unittest.TestCase):
    def started(self, files):
        return {name for name in pr_workflows() if pr_paths(name) is not None and starts(name, files)}

    def test_a_recorded_case_only_starts_the_recorded_replays(self):
        # #700 (14 Oct 2026): a new case.json and form.html ran the harness tests
        self.assertEqual(self.started(['desktop/e2e/recorded/combo-never-opens-late-answers-1/case.json', 'desktop/e2e/recorded/combo-never-opens-late-answers-1/form.html']),
                         {'page-cases.yml'})

    def test_docs_and_tools_start_python_only(self):
        self.assertEqual(self.started(['docs/HOW-IT-RUNS.md', 'tools/ship.sh', 'CLAUDE.md']), {'tests-python.yml'})

    def test_the_apply_flow_starts_its_replays_and_desktop(self):
        self.assertEqual(self.started(['extension/fill-flow.js']), {'tests-desktop.yml', 'tests-worker.yml', 'page-cases.yml', 'control-tests.yml', 'site-replays-pr.yml'})   # worker tests read extension/ (14 Oct 2026)
        self.assertIn('site-replays-pr.yml', self.started(['desktop/lib/server.js']))

    def test_the_harness_code_starts_the_harness(self):
        started = self.started(['desktop/e2e/lib/forms.mjs'])
        self.assertLessEqual({'harness.yml', 'tests-desktop.yml', 'page-cases.yml', 'control-tests.yml'}, started)
        self.assertIn('site-replays-pr.yml', started, 'owner, 14 Oct 2026: the replay machinery starts the PR site replays too')
        self.assertIn('site-replays-pr.yml', self.started(['desktop/e2e/replay-gate.mjs']))
        self.assertNotIn('site-replays-pr.yml', self.started(['desktop/e2e/record-sites.mjs']), 'the recorder is not a replay')

    def test_a_worker_or_site_change_starts_only_its_suite(self):
        self.assertEqual(self.started(['worker/src/index.js']), {'tests-worker.yml'})
        self.assertEqual(self.started(['worker/src/report.js']), {'tests-worker.yml', 'tests-desktop.yml'}, 'a desktop test reads it')
        self.assertEqual(self.started(['site/src/aicost.js']), {'tests-site.yml'})

    def test_a_workflow_change_starts_that_workflow(self):
        for name in pr_workflows():
            if pr_paths(name) is not None:
                self.assertTrue(starts(name, [f'.github/workflows/{name}']) or name == 'site-replays-pr.yml', name)


if __name__ == '__main__':
    unittest.main()
