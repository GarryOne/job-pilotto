"""tools/affected-jobs.py + tools/ci-needed.sh (owner, 12 Oct 2026: "why do we run this test harness, if not relevant code has been changed"): every required check
of a pull request asks the push hook's pick, per job, whether the change can break it, and skips its heavy steps when not. These tests pin the class (every required
job decides first, a new one without the step fails), the real PR shapes it was measured on, and the safety rules (whole-repo listers, plumbing, the harness reads)."""
import importlib.util
import os
import re
import shlex
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('affected_jobs', ROOT / 'tools/affected-jobs.py')
jobs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(jobs)

# Required jobs that stay as they are, and why: each is checked below to still be cheap or to decide on its own.
CHEAP = {'gates': 'the pure checks: seconds, nothing installed', 'flow-fresh': 'git and one node script: seconds'}
OWN_DECIDE = {'hole3': 'tools/recorded-fails-on-old.mjs lists the cases a PR brings, from git, before any install',
              'cases-fail-before-fix': 'the same job after its rename'}
FOLLOWS = {'report': "needs.replay.outputs.ran != 'false'"}   # replays to /admin/applying: runs when the replay shards ran, skipped (= passed) otherwise
NEEDED = "steps.needed.outputs.run == 'true'"


def required():
    text = (ROOT / 'tools/pr-settings.sh').read_text()
    return shlex.split(re.search(r"^checks='(.*)'$", text, re.M).group(1))


def workflow_jobs():
    """-> [(workflow file, job id, regex of its check name, its text)] for every job of a workflow a pull request runs."""
    found = []
    for workflow in sorted((ROOT / '.github/workflows').glob('*.yml')):
        text = workflow.read_text()
        if not re.search(r'^\s*pull_request\b', text.split('\njobs:')[0], re.M):
            continue
        body = text.split('\njobs:\n', 1)[1]
        for block in re.split(r'(?m)^(?=  [\w-]+:\s*(?:#.*)?$)', body):
            job = re.match(r'  ([\w-]+):', block)
            if not job:
                continue
            name = re.search(r'(?m)^    name:\s*(.+?)\s*$', block)
            if name:
                parts = re.split(r'\$\{\{[^}]*\}\}', name.group(1).strip('\'"'))
                pattern = '^' + '.+'.join(re.escape(part) for part in parts) + '$'
            else:
                pattern = '^' + re.escape(job.group(1)) + r'( \(.+\))?$'
            found.append((workflow.name, job.group(1), re.compile(pattern), block))
    return found


def steps(block):
    return [step for step in re.split(r'(?m)^(?=      - )', block.split('\n    steps:\n', 1)[1]) if step.startswith('      - ')]


class EveryRequiredJobDecidesFirst(unittest.TestCase):
    def test_every_required_check_asks_the_pick_before_its_heavy_steps(self):
        checks, found = required(), workflow_jobs()
        self.assertGreater(len(checks), 10, 'positive control: the required list is read')
        asked = set()
        for check in checks:
            matches = [(wf, job, block) for wf, job, pattern, block in found if pattern.match(check)]
            self.assertTrue(matches, f'required check "{check}" is no job of a pull request workflow')
            wf, job, block = matches[0]
            where = f'{check} ({wf} job {job})'
            if job in CHEAP:
                self.assertNotRegex(block, r'npm ci|npm install|playwright install', f'{where} is listed as cheap ({CHEAP[job]}) but installs: give it the needed step')
                continue
            if job in OWN_DECIDE:
                self.assertIn('recorded-fails-on-old.mjs', block, where)
                continue
            if job in FOLLOWS:
                self.assertIn(FOLLOWS[job], block, where)
                continue
            listed = steps(block)
            decide = [i for i, step in enumerate(listed) if re.search(r'run: bash tools/ci-needed\.sh', step)]
            self.assertEqual(len(decide), 1, f'{where}: no step `bash tools/ci-needed.sh <job>` (a new required job decides first, or is listed here with why)')
            first = decide[0]
            self.assertRegex(listed[first], r'id: needed\b', where)
            name = re.search(r'tools/ci-needed\.sh (\w+)', listed[first]).group(1)
            self.assertIn(name, jobs.JOBS, f'{where}: ci-needed.sh {name} is no job of tools/affected-jobs.py')
            asked.add(name)
            self.assertTrue(all('actions/checkout' in step for step in listed[:first]), f'{where}: only the checkout comes before the decision')
            self.assertRegex(''.join(listed[:first]), r'fetch-depth: [02]\b', f'{where}: the checkout needs the merge commit and its parent (fetch-depth 2)')
            later = [step.splitlines()[0] + ' ...' for step in listed[first + 1:] if NEEDED not in step]
            self.assertEqual(later, [], f'{where}: a step after the decision runs whatever it says')
        self.assertEqual(asked, set(jobs.JOBS), 'every job of the pick is asked by some required check, and no job asks one the pick does not have')

    def test_no_pull_request_workflow_lists_paths_of_its_own(self):
        # One source of "what can this change break" (tools/affected-jobs.py): no `on: paths:` (a required check that never reports blocks the PR) and no grep of the diff.
        for wf, job, _, block in workflow_jobs():
            self.assertNotRegex(block, r'git diff --name-only[^\n]*\|\s*grep', f'{wf} {job}')
        for name in ('build.yml', 'pr-gate.yml', 'recorded-pages.yml', 'widget-zoo.yml'):
            on = (ROOT / '.github/workflows' / name).read_text().split('\njobs:')[0]
            self.assertNotRegex(on, r'(?m)^\s+paths(-ignore)?:', name)


class TheShapesItWasMeasuredOn(unittest.TestCase):
    def ran(self, files):
        return {job for job, why in jobs.reasons(files).items() if why}

    def test_a_docs_and_ship_change_skips_the_harness_replays_zoo_worker_and_site(self):
        # PR #510: every required check ran (986 job-seconds). python reads them; desktop too: codemap.test.js reads tools/ headers, file-size.test.js and skill-names.test.js every tracked file.
        ran = self.ran(['AGENTS.md', 'CLAUDE.md', 'tests/test_ship_endings.py', 'tools/ship.sh'])
        self.assertEqual(ran, {'python', 'desktop'})
        self.assertIn('codemap.test.js reads tools/', jobs.reason('desktop', ['tools/ship.sh']), 'a header of tools/ is one codemap.test.js checks')

    def test_an_extension_change_runs_the_replays_the_harness_and_desktop(self):
        # PR #486
        ran = self.ran(['CLAUDE.md', 'desktop/e2e/recorded/email-first-no-step-1/case.json', 'desktop/e2e/recorded/email-first-no-step-1/login.html',
                        'extension/fill-flow.js', 'extension/fingerprint.json', 'extension/manifest.json'])
        self.assertLessEqual({'replays', 'harness', 'desktop', 'zoo'}, ran)
        self.assertTrue(jobs.reasons(['extension/fill-flow.js'])['replays'])

    def test_a_harness_lib_change_runs_the_harness_tests(self):
        # PR #509
        ran = self.ran(['.github/workflows/pool-smoke.yml', 'desktop/e2e/lib/pool-ci.mjs', 'desktop/e2e/lib/smoke.mjs', 'desktop/e2e/pool-ai-cost.mjs',
                        'desktop/e2e/pool-ci-summary.mjs', 'desktop/e2e/test/pool-ai-cost.test.mjs', 'site/src/jobcost.js'])
        self.assertIn('harness', ran)

    def test_docs_alone_run_no_replay_and_no_harness_lib(self):
        self.assertFalse(self.ran(['docs/rules/files.md']) & {'replays', 'zoo', 'worker', 'site'})

    def test_markdown_a_test_reads_runs_its_job(self):
        # The push pick ignores Markdown (NO_TEST_EFFECT); a CI skip may not: test_how_it_runs reads docs/HOW-IT-RUNS.md, test_ship_endings every *.md.
        self.assertTrue(jobs.reasons(['docs/HOW-IT-RUNS.md'])['python'])


class WhenInDoubtItRuns(unittest.TestCase):
    def test_the_jobs_plumbing_and_root_dependencies_run_every_job(self):
        for f in ('tools/affected-jobs.py', 'tools/affected-tests.py', 'tools/replay-files.mjs', 'tools/ci-needed.sh', 'tools/check.py', '.github/workflows/build.yml',
                  '.github/workflows/pr-gate.yml', '.github/workflows/recorded-pages.yml', '.github/workflows/widget-zoo.yml', 'package.json', 'requirements.txt',
                  'eslint.config.mjs', 'something/new.bin', '.claude/settings.json'):
            self.assertTrue(all(jobs.reasons([f]).values()), f)

    def test_a_test_that_lists_the_whole_repo_runs_its_job_for_any_file(self):
        self.assertIn('lists the whole repo', jobs.reasons(['site/public/robots.txt'])['desktop'])   # file-size.test.js: git ls-files, no folder

    def test_a_test_that_names_a_folder_runs_its_job_for_a_file_in_it(self):
        # codemap.test.js reads every header of tools/, src/ and worker/src through desktop/scripts/codemap.mjs: path pieces joined, not one quoted path
        paths, _ = jobs.named((ROOT / 'desktop/scripts/codemap.mjs').resolve())
        self.assertLessEqual({'tools/', 'src/', 'worker/src/'}, set(paths))
        paths, _ = jobs.named((ROOT / 'desktop/test/audience.test.js').resolve())
        self.assertIn('tests/fixtures/audience_cases.json', paths)
        self.assertNotIn('tests/', paths, 'the joined path wins over its pieces')

    def test_words_that_are_not_paths_name_nothing(self):
        with tempfile.TemporaryDirectory(dir=ROOT / 'desktop/e2e/test') as tmp:
            probe = Path(tmp) / 'probe.test.mjs'
            probe.write_text("const env = {E2E_KEY: 'tests'};\nassert.deepEqual(keys, ['KEY', 'tests']);\n// reads docs/ and tools/ in a comment\n")
            self.assertEqual(jobs.named(probe.resolve()), (frozenset(), False))

    def test_what_the_stage_step_copies_counts_for_the_jobs_that_stage(self):
        self.assertLessEqual({'worker/src/', 'extension/alias-schema.js'}, set(jobs.staged()))
        self.assertTrue(jobs.reasons(['worker/src/report.js'])['harness'])

    def test_a_replay_job_runs_for_what_the_replay_loads_and_the_scripts_it_starts_by_path(self):
        replays = jobs.loads('replays')
        self.assertTrue(replays, 'node lists what a replay loads')
        for path in ('extension/', 'desktop/e2e/recorded/', 'desktop/e2e/test/recorded-pages.test.mjs', 'desktop/e2e/lib/offline-app-child.mjs', 'desktop/lib/server.js'):
            self.assertIn(path, replays, path)
        self.assertIn('desktop/e2e/widget-zoo/', jobs.loads('zoo'))
        self.assertIsNone(jobs.reasons(['desktop/renderer/pages/activity.js'])['replays'], 'the window\'s pages are no part of a replay')

    def test_every_file_a_harness_test_reads_runs_the_harness(self):
        # The brief's guard: a harness test that reads a product file the pick does not map to it would let a PR skip the harness and break main.
        missed = []
        for test in sorted((ROOT / 'desktop/e2e/test').glob('*.test.mjs')):
            text = test.read_text(errors='replace')
            for literal in set(re.findall(r"""['"`]([\w@.-]*/[\w@./-]+\.(?:m?js|json|ya?ml|md|py|sh|html|css))['"`]""", text)):
                for base in (test.parent, ROOT):
                    target = (base / literal).resolve()
                    if target.is_file() and target.is_relative_to(ROOT) and 'node_modules' not in target.parts:
                        file = target.relative_to(ROOT).as_posix()
                        if not jobs.reason('harness', [file]):
                            missed.append(f'{test.name} reads {file}')
                        break
        self.assertEqual(missed, [])


class TheStepInTheJob(unittest.TestCase):
    """tools/ci-needed.sh in a throwaway repo, with a stand-in pick: the verdict it writes for each situation."""

    def setUp(self):
        self.repo = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.repo, ignore_errors=True)
        (self.repo / 'tools').mkdir()
        shutil.copy(ROOT / 'tools/ci-needed.sh', self.repo / 'tools/ci-needed.sh')
        self.pick = self.repo / 'tools/affected-jobs.py'
        self.git('init', '-q', '-b', 'main')
        self.git('commit', '-q', '--allow-empty', '-m', 'base')

    def git(self, *args):
        subprocess.run(['git', '-c', 'user.email=t@t', '-c', 'user.name=t', *args], cwd=self.repo, check=True, capture_output=True)

    def merge_commit(self):
        self.git('checkout', '-q', '-b', 'pr')
        self.git('commit', '-q', '--allow-empty', '-m', 'change')
        self.git('checkout', '-q', 'main')
        self.git('merge', '-q', '--no-ff', 'pr', '-m', 'merge')

    def verdict(self, event, pick='print("skip: nothing")'):
        self.pick.write_text(pick + '\n')
        out = self.repo / 'out.txt'
        out.unlink(missing_ok=True)
        env = {**os.environ, 'GITHUB_EVENT_NAME': event, 'GITHUB_OUTPUT': str(out)}
        shown = subprocess.run(['bash', 'tools/ci-needed.sh', 'desktop'], cwd=self.repo, env=env, capture_output=True, text=True).stdout
        return out.read_text().strip(), shown

    def test_a_pull_request_the_pick_clears_skips(self):
        self.merge_commit()
        self.assertEqual(self.verdict('pull_request'), ('run=false', 'desktop: skip: nothing\n'))

    def test_a_pull_request_the_pick_reaches_runs(self):
        self.merge_commit()
        self.assertEqual(self.verdict('pull_request', 'print("run: x reads y")')[0], 'run=true')

    def test_a_push_to_main_always_runs(self):
        self.merge_commit()
        self.assertEqual(self.verdict('push')[0], 'run=true')

    def test_no_merge_commit_or_a_failing_pick_runs(self):
        self.assertEqual(self.verdict('pull_request')[0], 'run=true', 'HEAD is not a merge: what the PR changes is unknown')
        self.merge_commit()
        self.assertEqual(self.verdict('pull_request', 'import sys; print("skip: half"); sys.exit(1)')[0], 'run=true', 'the pick failed')


if __name__ == '__main__':
    unittest.main()
