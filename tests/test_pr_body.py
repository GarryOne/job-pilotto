"""tools/pr-body.sh, the description of a PR that tools/ship.sh opens (owner, 12 Oct 2026: "I have 2-5 seconds to look at it; not an essay").
The session's short summary (--body=<file>) comes first, then a table of the facts, and the commit message only folded in a <details>."""
import os
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent


def git(cwd, *args):
    return subprocess.run(['git', '-C', str(cwd), *args], check=True, capture_output=True, text=True).stdout.strip()


class PrBodyTest(unittest.TestCase):
    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp())
        self.repo = self.tmp / 'repo'
        self.repo.mkdir()
        git(self.repo, 'init', '-q', '-b', 'main')
        git(self.repo, 'config', 'user.email', 't@x'); git(self.repo, 'config', 'user.name', 'T')
        (self.repo / 'a.txt').write_text('a\n'); git(self.repo, 'add', '.'); git(self.repo, 'commit', '-qm', 'Start')
        self.base = git(self.repo, 'rev-parse', 'HEAD')
        message = ('A control the page did not take is marked\n\nA long paragraph that explains the change in full detail, '
                   'line after line, as a commit message should.\n\nPool-row: Ocado Technology (found 2026-10-10)\nRung: 2\nFixture: fv-en-city-reverted\n'
                   'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n')
        (self.repo / 'b.txt').write_text('b\n'); git(self.repo, 'add', '.'); git(self.repo, 'commit', '-qm', message)

    def body(self, *args):
        result = subprocess.run(['bash', str(ROOT / 'tools' / 'pr-body.sh'), self.base, *args], cwd=self.repo, capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout

    def test_the_summary_comes_first_and_the_commit_message_is_folded(self):
        summary = self.tmp / 'summary.md'
        summary.write_text('### ✅ Ocado: menus picked by meaning\n\n- **Why:** the 11 Oct pool run left 3 menus empty\n\n| | Before | After |\n|---|---|---|\n| filled | 8 | 11 |\n')
        text = self.body(f'--body={summary}')
        self.assertTrue(text.startswith('### ✅ Ocado: menus picked by meaning'), text[:200])
        details = text.index('<details>')
        self.assertLess(text.index('**Why:** the 11 Oct pool run left 3 menus empty'), details)
        self.assertGreater(text.index('A long paragraph'), details, 'the essay is folded, never above the fold')
        self.assertIn('</details>', text)
        self.assertTrue(text.rstrip().endswith('🤖 Generated with [Claude Code](https://claude.com/claude-code)'))

    def test_the_facts_are_a_short_table_from_the_trailers(self):
        text = self.body()
        head = text[:text.index('<details>')]
        self.assertIn('| 🎯 Pool row | Ocado Technology (found 2026-10-10) |', head)
        self.assertIn('| 🪜 Rung | 2 |', head)
        self.assertIn('| 🧪 Fixture | fv-en-city-reverted |', head)
        self.assertNotIn('Co-Authored-By', head)

    def test_without_a_summary_the_subject_leads_and_nothing_long_is_above_the_fold(self):
        text = self.body()
        self.assertTrue(text.startswith('### A control the page did not take is marked'), text[:120])
        head = text[:text.index('<details>')]
        self.assertTrue(all(len(line) <= 160 for line in head.splitlines()), head)

    def test_a_pr_body_line_the_ci_reads_stays_in_the_body(self):
        summary = self.tmp / 'summary.md'
        summary.write_text('### Fix\n\n- **Why:** the owner saw it\n\n| | Before | After |\n|---|---|---|\n| a | 1 | 2 |\n\nlive-row: Personio form in German\nlive-applicant: thin\n')
        text = self.body(f'--body={summary}')
        self.assertIn('\nlive-row: Personio form in German\n', text)
        self.assertIn('\nlive-applicant: thin\n', text)


    def test_a_summary_without_a_why_or_a_before_after_is_refused(self):
        # Owner, 13 Oct 2026: "Explaining why a change is needed: how we decided that we need this. And a before/after."
        for text, missing in [('### ✅ X\n\n| | Before | After |\n|---|---|---|\n| a | 1 | 2 |\n', 'Why'),
                              ('### ✅ X\n\n- **Why:** the owner saw it\n', 'Before'),
                              ('### ✅ X\n- did a thing\n', 'Why')]:
            summary = self.tmp / 'bad.md'; summary.write_text(text)
            result = subprocess.run(['bash', str(ROOT / 'tools' / 'pr-body.sh'), self.base, f'--body={summary}'], cwd=self.repo, capture_output=True, text=True, timeout=30)
            self.assertNotEqual(result.returncode, 0, text)
            self.assertIn(missing, result.stderr)


if __name__ == '__main__':
    unittest.main()
