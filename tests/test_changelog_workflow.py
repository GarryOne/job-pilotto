"""changelog-publish.yml: the What's new page publishes itself for every beta and stable (owner, 18 Oct 2026), without a commit or a PR."""
import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
FLOW = (ROOT / '.github/workflows/changelog-publish.yml').read_text()
CODE = re.sub(r'(?m)^\s*#.*$', '', FLOW)


class ChangelogWorkflowTests(unittest.TestCase):
    def test_it_starts_by_itself_when_a_release_run_ends_with_an_hourly_backup(self):
        triggers = FLOW.split('permissions:')[0]
        self.assertRegex(triggers, r"workflow_run:\s+workflows: \['Release · Build, test, beta'\]")
        self.assertIn('schedule:', triggers)
        self.assertIn('workflow_dispatch:', triggers)

    def test_the_release_workflow_it_waits_for_exists_under_that_name(self):
        self.assertIn("name: Release · Build, test, beta", (ROOT / '.github/workflows/desktop.yml').read_text())

    def test_it_never_commits_pushes_or_opens_a_pr(self):
        for word in ('git commit', 'git push', 'gh pr ', 'contents: write', 'pull-requests: write'):
            self.assertNotIn(word, CODE, word)

    def test_it_publishes_with_the_site_key_and_reports_its_ai_cost(self):
        self.assertIn('SELFHEAL_PUBLISH_KEY', CODE)
        self.assertIn('--job changelog-publish', CODE)
        self.assertIn('fetch-depth: 0', CODE)   # the commits between two release tags

    def test_one_run_at_a_time_and_a_run_that_fails_says_why_in_its_log(self):
        self.assertIn('group: changelog-publish', CODE)
        self.assertIn('tee', CODE)

    def test_its_tool_is_watched_by_the_site_tests(self):
        self.assertIn("'tools/changelog-publish.mjs'", (ROOT / '.github/workflows/tests-site.yml').read_text())


if __name__ == '__main__':
    unittest.main()
