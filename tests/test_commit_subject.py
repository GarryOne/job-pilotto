"""The commit-time subject check (tools/commit-subject.py, used by tools/pre-push-check.sh) reads every way a commit message is given inline."""
import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('commit_subject', Path(__file__).resolve().parent.parent / 'tools' / 'commit-subject.py')
commit_subject = importlib.util.module_from_spec(spec)
spec.loader.exec_module(commit_subject)
subject = commit_subject.subject


class CommitSubjectTest(unittest.TestCase):
    def test_inline_forms(self):
        self.assertEqual(subject('git commit -m "Fix it"'), 'Fix it')
        self.assertEqual(subject("git commit -qm 'Fix it'"), 'Fix it')
        self.assertEqual(subject('git add -A && git commit -am "Fix it\n\nbody"'), 'Fix it')
        self.assertEqual(subject('git commit --message="Fix it"'), 'Fix it')

    def test_heredoc_takes_its_first_line(self):
        self.assertEqual(subject("git commit -m \"$(cat <<'EOF'\nFix it\n\nA long body line\nEOF\n)\""), 'Fix it')

    def test_nothing_to_read(self):
        self.assertEqual(subject('git commit'), '')
        self.assertEqual(subject('git commit -F msg.txt'), '')
        self.assertEqual(subject('git status -m "x"'), '')


if __name__ == '__main__':
    unittest.main()
