"""Release · Build, test, beta workflow: builds for everything the app bundles, a 403 after main moved hands over, and both gates run in the same run."""
import pathlib
import re
import unittest

WORKFLOW = (pathlib.Path(__file__).resolve().parent.parent / '.github/workflows/desktop.yml').read_text()
STAGE = (pathlib.Path(__file__).resolve().parent.parent / 'desktop/scripts/stage.mjs').read_text()


class DesktopWorkflowTest(unittest.TestCase):
    def test_every_bundled_folder_counts_as_a_change_for_the_nightly_build(self):
        # desktop/scripts/stage.mjs copies these into the app; a change to any of them must make tonight's build run.
        paths = re.search(r'paths=\((.*?)\)', WORKFLOW, re.S).group(1).split()
        for item in ['src', 'config', 'tools', 'extension', 'templates']:
            self.assertIn(item, STAGE)
            self.assertIn(item, paths)

    def test_builds_are_nightly_or_by_hand_never_per_push(self):
        # 2 Oct 2026: a release per push was a macOS + Windows build for every commit. Nightly, plus gh workflow run desktop.yml.
        triggers = WORKFLOW.split('permissions:')[0]
        self.assertIsNone(re.search(r'^\s*push:', triggers, re.M))   # a trigger key, not the word inside a comment
        # 04:00 in Zurich all year (2 Oct 2026): UTC+2 in summer, UTC+1 in winter, so both UTC hours are scheduled and a guard lets the one at 04:xx/05:xx Zurich time go on.
        # Not on the hour (5 Oct 2026): 0 2 and 0 3 were started six hours late two days running. ONE backup slot at :17 (owner, 10 Oct 2026: "the nightly beta should run
        # only once"): the Worker's cron starts the nightly; the GitHub cron is the backup and skips when a nightly already ran today.
        self.assertEqual(re.findall(r"cron: '([^']+)'", triggers), ['17 5 * * *'])
        self.assertIn('select(.displayTitle == \\"Nightly beta\\")', WORKFLOW)
        self.assertIn('A nightly beta already ran today', WORKFLOW)
        self.assertNotRegex(triggers, r"cron: '0 \d+ ")
        self.assertIn('TZ=Europe/Zurich date +%H', WORKFLOW)
        # A late start still builds (4 Oct 2026: both runs came six hours late and the old 04-05 guard skipped them): 04:00-15:59.
        self.assertIn('[ $((10#$hour)) -lt 4 ] || [ $((10#$hour)) -gt 15 ]', WORKFLOW)
        self.assertIn('workflow_dispatch:', triggers)
        # The Worker's cron starts the nightly on time (worker/src/scheduler.js): named, diffed like the schedule, and with no 04:00-15:59 window of its own.
        self.assertIn("run-name: ${{ (inputs.nightly || github.event_name == 'schedule') && 'Nightly beta'", WORKFLOW)
        self.assertIn("inputs.beta && 'Beta by hand'", WORKFLOW)
        self.assertIn('select(.displayTitle == "Beta by hand")', (pathlib.Path(__file__).resolve().parent.parent / 'tools/beta-release.sh').read_text())
        self.assertIn('[ "$GITHUB_EVENT_NAME" != schedule ] && [ "$NIGHTLY" != true ]', WORKFLOW)
        self.assertIn('[ "$GITHUB_EVENT_NAME" = schedule ] && { [ $((10#$hour)) -lt 4 ]', WORKFLOW)
        self.assertIn("if: steps.diff.outputs.build == 'true'", WORKFLOW)   # nothing new: no version, no tag, no release
        self.assertIn("if: needs.changes.outputs.released == 'true'", WORKFLOW)   # and so no lane
        self.assertIn('[ "$GITHUB_EVENT_NAME" != schedule ]', WORKFLOW)   # a manual run always builds

    def test_a_night_when_only_the_apps_tests_changed_builds_nothing(self):
        # desktop/ holds the app and its tests: the tests are not in the app, and the e2e pipeline promotes whatever the nightly builds.
        paths = re.search(r'paths=\((.*?)\)', WORKFLOW, re.S).group(1).split()
        self.assertIn("':!desktop/e2e'", paths)
        self.assertIn("':!desktop/test'", paths)

    def test_the_nightly_compares_against_the_last_release_that_reached_someone(self):
        # 9 Oct 2026: the failed 0.6.12 build was "the last release", so the nightly built nothing and the fix waited. A build that failed its
        # gate never counts; a stable or a build approved as beta on one platform does. Runs the workflow's own jq on sample releases.
        import json, shutil, subprocess
        jq = shutil.which('jq')
        if not jq:
            self.skipTest('jq is not installed')
        query = re.search(r"--jq '(.*?)' \|\| true\)", WORKFLOW).group(1)
        releases = [
            {'tag_name': 'draft', 'draft': True, 'prerelease': True, 'body': 'Beta-approved: x'},
            {'tag_name': 'failed-build', 'draft': False, 'prerelease': True, 'body': 'Built from abc\nNot approved'},
            {'tag_name': 'windows-beta', 'draft': False, 'prerelease': True, 'body': 'notes\nBeta-approved (Windows): passed'},
            {'tag_name': 'stable', 'draft': False, 'prerelease': False, 'body': ''},
        ]
        pick = lambda rows: subprocess.run([jq, '-r', query], input=json.dumps(rows), capture_output=True, text=True, check=True).stdout.strip()
        self.assertEqual(pick(releases), 'windows-beta')
        self.assertEqual(pick(releases[:2] + releases[3:]), 'stable')
        self.assertEqual(pick(releases[:2]), '')   # nothing reached anyone: build

    def test_release_403_after_main_moved_starts_a_fresh_build(self):
        self.assertIn("grep -q 'HTTP 403' release-error.txt", WORKFLOW)
        self.assertIn('"$(git rev-parse origin/main)" != "$GITHUB_SHA"', WORKFLOW)
        self.assertIn('gh workflow run desktop.yml --ref main', WORKFLOW)
        # a draft left by an unfinished build is replaced; a published release under the same tag stops the build (6 Oct 2026)
        self.assertIn('gh release delete "$tag" --yes; echo "::warning::Removed a draft $tag', WORKFLOW)
        self.assertIn('is already published (another build took this version)', WORKFLOW)
        # the fresh build keeps what the refused one was: a beta stays a beta (gated and approved), a nightly a nightly (6 Oct 2026)
        self.assertIn("-f beta=${{ inputs.beta && 'true' || 'false' }}", WORKFLOW)
        self.assertIn("-f nightly=${{ (inputs.nightly || github.event_name == 'schedule') && 'true' || 'false' }}", WORKFLOW)

    def test_each_lane_is_build_then_e2e_then_release_one_box_each(self):
        # Owner, 7 Oct 2026: "Anything new? -> Build -> E2E -> Release" per platform, "literally that clean": each step one box (a job or one matrix), no called workflows.
        job = lambda name: WORKFLOW.split(f'\n  {name}:\n')[1].split('\n\n  # ')[0]
        self.assertNotIn('uses: ./.github/workflows/', WORKFLOW, 'a called workflow draws all its jobs in the graph')
        self.assertIn('needs: changes ', job('build'))
        self.assertIn('needs: changes ', job('windows'))
        # The same unit tests on both platforms, only the desktop app's: Python pipeline + app, never the Worker or the site (own pipelines; owner, 10 Oct 2026).
        mac_unit = job('build').split('Unit tests · desktop app')[1].split('- name:')[0]
        win_unit = job('windows').split('Unit tests · desktop app')[1].split('- name:')[0]
        # The same step on both platforms, apart from the list of areas: TEMPORARILY Windows runs only the app's tests (196 Python tests fail there for environmental reasons;
        # owner, 10 Oct 2026: fix them, then run both). When that is done: set Windows' UNIT_AREAS to 'python desktop' in desktop.yml and delete WINDOWS_PYTHON_PENDING here.
        WINDOWS_PYTHON_PENDING = True
        areas = lambda text: re.search(r"UNIT_AREAS: '([^']*)'", text).group(1)
        self.assertEqual(areas(mac_unit), 'python desktop')
        self.assertEqual(areas(win_unit), 'desktop' if WINDOWS_PYTHON_PENDING else 'python desktop')
        script = lambda text: text.split('run: |')[1]
        self.assertEqual(script(mac_unit), script(win_unit))
        self.assertIn('for area in $UNIT_AREAS; do bash tools/check.sh --area "$area"', script(mac_unit))
        for area in ('worker', 'site'):
            self.assertNotIn(f'--area {area}', job('build') + job('windows'))
            self.assertNotIn(f' {area} ', mac_unit.split('for area in')[1].split(';')[0] + ' ')
        # A build is "compiles, the unit tests pass, a very small smoke passes" (owner, 10 Oct 2026), as NAMED STEPS of the one Build box, never boxes of their own
        # ("Put Compile, Smoke inside the Build"): the graph stays Anything new? -> Build -> E2E -> Release.
        for box in ('compile-mac', 'unit-mac', 'smoke-mac', 'compile-windows', 'unit-windows', 'smoke-windows', 'packaging-windows'):
            self.assertNotIn(f'\n  {box}:\n', WORKFLOW, f'{box} would be a box of its own in the graph')
        for name, steps in (('build', ('Unit tests · desktop app (Python pipeline and app, side by side)', 'Compile · build and sign the app', 'Smoke test · the built app', 'mac-smoke.mjs')),
                            ('windows', ('Unit tests · desktop app (Python pipeline and app, side by side)', 'Compile · build the installer', 'Smoke test · the installed app', 'windows-smoke.mjs'))):
            for step in steps:
                self.assertIn(step, job(name))
            self.assertLess(job(name).index('Compile ·'), job(name).index('Smoke test ·'), 'the smoke test runs on what was compiled')
            self.assertLess(job(name).index('Smoke test ·'), job(name).index('Add to the release'), 'a build that fails its smoke test is not added to the release')
        # Smoke tests only in beta mode (a nightly or a beta by hand), never on a "Build only" run (owner, 10 Oct 2026)
        for name in ('build', 'windows'):
            smoke = job(name).split('Smoke test ·')[1].split('- name:')[0]
            self.assertIn("if: needs.changes.outputs.gate == 'true'", smoke)
        # Windows is not slower than the Mac in beta mode (owner, 10 Oct 2026: "why can't it be just like on Mac?"): its smoke is the same small set (mode smoke), and the slow
        # installed-app checks (add-on, update in place, in-app terminal: windows-smoke.mjs mode packaging) are the weekly run's (windows-smoke.yml, mode full), never a build step.
        self.assertNotIn('packaging', re.sub(r'#.*', '', job('windows')).replace('windows-smoke.mjs', ''))
        self.assertIn('windows-smoke.mjs "dist/Job-Pilotto-${VERSION}-x64.exe" smoke smoke', job('windows'))
        self.assertNotIn(' packaging', (pathlib.Path(__file__).resolve().parent.parent / '.github/workflows/windows-smoke.yml').read_text())   # the weekly run takes the default: full
        self.assertIn('needs: [changes, build]', job('test-mac'))
        self.assertIn('needs: [changes, windows]', job('test-windows'))
        self.assertIn('fromJson(needs.changes.outputs.mac_matrix)', job('test-mac'))
        self.assertIn('fromJson(needs.changes.outputs.windows_matrix)', job('test-windows'))
        # The Mac legs of a suite (sqlite and stand-in) are separate concurrency groups, as in e2e.yml: GitHub keeps one WAITING job per group, so a third contender
        # (the Windows job of the same suite) cancels one (10 Oct 2026: 15 of 41 Mac gate jobs cancelled). The Windows job shares the sqlite leg's group, `e2e-<suite>`.
        self.assertIn('group: e2e-${{ matrix.key }}', job('test-mac'))
        self.assertIn('group: e2e-${{ matrix.suite }}', job('test-windows'))
        self.assertIn('group: e2e-${{ matrix.key }}', (pathlib.Path(__file__).resolve().parent.parent / '.github/workflows/e2e.yml').read_text())   # the copy it is kept in step with
        for e2e in ('test-mac', 'test-windows'):   # the gate's settings: the fixed path
            self.assertIn("E2E_SEED: '0'", job(e2e))
        # The paid AI judge (owner, 7 Oct 2026: "$30 a week"): the nightly beta's Mac lane only, and not once today's e2e budget is spent; never on Windows.
        self.assertIn("E2E_FULL: ${{ (github.event_name == 'schedule' || inputs.nightly) && needs.changes.outputs.over != 'true' && '1' || '' }}", job('test-mac'))
        self.assertIn("E2E_FULL: ''", job('test-windows'))
        self.assertIn('node ai-spend.mjs', job('changes'))
        for name, e2e, script in (('release-mac', 'test-mac', 'tools/beta-approve.sh "$TAG"'), ('release-windows', 'test-windows', 'tools/beta-approve.sh --windows "$TAG"')):
            release = job(name)
            self.assertIn(f'needs: [changes, {e2e}]', release)
            self.assertIn(f"if: needs.{e2e}.result != 'success'", release)   # red, "not released", when an E2E suite failed
            self.assertIn(script, release)
        # only a nightly or a beta by hand is tested; the plan is made once, for both lanes
        self.assertIn("(github.event_name == 'schedule' || inputs.nightly || inputs.beta)", job('changes'))
        self.assertIn('node plan-run.mjs', job('changes'))
        # the Windows fallback is a step of Build · Windows, not a box
        self.assertIn('if: failure()', job('windows'))
        self.assertNotIn('\n  mac-only:\n', WORKFLOW)
        self.assertIn('needs: [changes, build, windows, test-mac, test-windows, release-mac, release-windows]', WORKFLOW)

if __name__ == '__main__':
    unittest.main()
