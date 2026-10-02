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
        self.assertIn("cron: '30 2 * * *'", triggers)
        self.assertIn('workflow_dispatch:', triggers)
        self.assertIn("if: needs.changes.outputs.build == 'true'", WORKFLOW)
        self.assertIn('[ "$GITHUB_EVENT_NAME" != schedule ]', WORKFLOW)   # a manual run always builds

    def test_release_403_after_main_moved_starts_a_fresh_build(self):
        self.assertIn("grep -q 'HTTP 403' release-error.txt", WORKFLOW)
        self.assertIn('"$(git rev-parse origin/main)" != "$GITHUB_SHA"', WORKFLOW)
        self.assertIn('gh workflow run desktop.yml --ref main', WORKFLOW)


if __name__ == '__main__':
    unittest.main()
