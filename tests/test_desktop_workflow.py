"""Release · Desktop app workflow: builds for everything the app bundles, and a 403 after main moved hands over."""
import pathlib
import unittest

WORKFLOW = (pathlib.Path(__file__).resolve().parent.parent / '.github/workflows/desktop.yml').read_text()
STAGE = (pathlib.Path(__file__).resolve().parent.parent / 'desktop/scripts/stage.mjs').read_text()


class DesktopWorkflowTest(unittest.TestCase):
    def test_every_bundled_folder_triggers_a_build(self):
        # desktop/scripts/stage.mjs copies these into the app; a change to any of them must build a release.
        for item in ['src', 'config', 'tools', 'templates']:
            self.assertIn(item, STAGE)
            self.assertIn(f"- '{item}/**'", WORKFLOW)

    def test_release_403_after_main_moved_starts_a_fresh_build(self):
        self.assertIn("grep -q 'HTTP 403' release-error.txt", WORKFLOW)
        self.assertIn('"$(git rev-parse origin/main)" != "$GITHUB_SHA"', WORKFLOW)
        self.assertIn('gh workflow run desktop.yml --ref main', WORKFLOW)


if __name__ == '__main__':
    unittest.main()
