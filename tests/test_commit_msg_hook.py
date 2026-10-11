"""tools/githooks/commit-msg (11 Oct 2026): a wrong trailer value fails at the commit, through the real git hook path (core.hooksPath), however the message is given."""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


@unittest.skipUnless(shutil.which('node') and shutil.which('git') and shutil.which('bash'), 'needs node, git and bash')
class CommitMsgHookTests(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.dir, ignore_errors=True)
        for rel in ('tools/commit-trailers.mjs', 'tools/rung-trailer.mjs', 'tools/githooks/commit-msg'):
            (self.dir / rel).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(ROOT / rel, self.dir / rel)
        (self.dir / 'desktop/e2e/ladder-fixtures').mkdir(parents=True)
        (self.dir / 'desktop/e2e/ladder-fixtures/aldi-suisse.json').write_text('{}')
        self.git('init', '-q')
        self.git('config', 'core.hooksPath', 'tools/githooks')   # what tools/worktree.sh sets: relative, so every worktree uses its own copy
        self.git('config', 'user.email', 't@example.com')
        self.git('config', 'user.name', 't')
        (self.dir / 'f.txt').write_text('x')
        self.git('add', '-A')

    def git(self, *args, env=None):
        return subprocess.run(['git', *args], cwd=self.dir, capture_output=True, text=True, env={**os.environ, **(env or {})})

    def commit(self, message, **kw):
        msg = self.dir / 'msg.txt'
        msg.write_text(message)
        return self.git('commit', '-q', '-F', str(msg), **kw)

    def test_a_wrong_rung_value_fails_the_commit_and_a_right_one_passes(self):
        bad = self.commit('Fix\n\nRung: seven\n')
        self.assertNotEqual(bad.returncode, 0)
        self.assertIn('"Rung: seven"', bad.stderr)
        self.assertNotEqual(self.git('rev-parse', '--verify', '-q', 'HEAD').returncode, 0, 'no commit was made')
        ok = self.commit('Fix\n\nRung: 3\nFixture: aldi-suisse\n')
        self.assertEqual(ok.returncode, 0, ok.stderr)

    def test_an_unknown_fixture_and_a_reasonless_trailer_fail(self):
        self.assertIn('no fixture "nope"', self.commit('Fix\n\nFixture: nope\n').stderr)
        self.assertIn('needs a reason', self.commit('Fix\n\nRecorded-unneeded:\n').stderr)

    def test_the_escape_hatch_and_no_verify_skip_it(self):
        self.assertEqual(self.commit('Fix\n\nRung: seven\n', env={'COMMIT_TRAILERS_OK': '1'}).returncode, 0)
        (self.dir / 'g.txt').write_text('y')
        self.git('add', '-A')
        self.assertEqual(self.git('commit', '-q', '--no-verify', '-m', 'Fix\n\nRung: seven').returncode, 0)

    def test_a_message_without_trailers_passes(self):
        self.assertEqual(self.commit('Fix a label\n\nbody\n').returncode, 0)

    def test_worktree_and_ship_set_the_hooks_path(self):
        for tool in ('tools/worktree.sh', 'tools/ship.sh'):
            self.assertIn('core.hooksPath tools/githooks', (ROOT / tool).read_text(), tool)


if __name__ == '__main__':
    unittest.main()
