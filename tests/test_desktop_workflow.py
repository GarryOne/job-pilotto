"""Release · Desktop app workflow: builds for everything the app bundles, and a 403 after main moved hands over."""
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
        # Not on the hour (5 Oct 2026): 0 2 and 0 3 were started six hours late two days running. Four slots at :17, and none on the busy :00.
        for hour in (2, 3, 4, 5):
            self.assertIn(f"cron: '17 {hour} * * *'", triggers)
        self.assertNotRegex(triggers, r"cron: '0 \d+ ")
        self.assertIn('TZ=Europe/Zurich date +%H', WORKFLOW)
        # A late start still builds (4 Oct 2026: both runs came six hours late and the old 04-05 guard skipped them): 04:00-15:59.
        self.assertIn('[ $((10#$hour)) -lt 4 ] || [ $((10#$hour)) -gt 15 ]', WORKFLOW)
        self.assertIn('workflow_dispatch:', triggers)
        self.assertIn("if: needs.changes.outputs.build == 'true'", WORKFLOW)
        self.assertIn('[ "$GITHUB_EVENT_NAME" != schedule ]', WORKFLOW)   # a manual run always builds

    def test_a_night_when_only_the_apps_tests_changed_builds_nothing(self):
        # desktop/ holds the app and its tests: the tests are not in the app, and the e2e pipeline promotes whatever the nightly builds.
        paths = re.search(r'paths=\((.*?)\)', WORKFLOW, re.S).group(1).split()
        self.assertIn("':!desktop/e2e'", paths)
        self.assertIn("':!desktop/test'", paths)

    def test_release_403_after_main_moved_starts_a_fresh_build(self):
        self.assertIn("grep -q 'HTTP 403' release-error.txt", WORKFLOW)
        self.assertIn('"$(git rev-parse origin/main)" != "$GITHUB_SHA"', WORKFLOW)
        self.assertIn('gh workflow run desktop.yml --ref main', WORKFLOW)


if __name__ == '__main__':
    unittest.main()
