"""tools/auto-pull.sh keeps the owner's checkout on origin/main (owner, 14 Oct 2026): it fast-forwards a clean main only, never touches a dirty tree,
another branch or a diverged history, says a skip once, and says after an update whether the app needs a restart or only ⌘R."""
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / 'tools' / 'auto-pull.sh'


def git(cwd, *args):
    return subprocess.run(['git', '-C', str(cwd), *args], check=True, capture_output=True, text=True).stdout.strip()


class AutoPullTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.origin, self.repo, self.other = self.tmp / 'origin.git', self.tmp / 'repo', self.tmp / 'other'
        subprocess.run(['git', 'init', '-q', '--bare', '-b', 'main', str(self.origin)], check=True)
        subprocess.run(['git', 'clone', '-q', str(self.origin), str(self.other)], check=True, capture_output=True)
        for repo in (self.other,):
            git(repo, 'config', 'user.email', 't@example.org'); git(repo, 'config', 'user.name', 't')
        self.commit('README.md', 'one')
        subprocess.run(['git', 'clone', '-q', str(self.origin), str(self.repo)], check=True, capture_output=True)
        git(self.repo, 'config', 'user.email', 't@example.org'); git(self.repo, 'config', 'user.name', 't')
        self.notices = self.tmp / 'notices'

    def commit(self, path, text, repo=None):
        repo = repo or self.other
        (repo / path).parent.mkdir(parents=True, exist_ok=True)
        (repo / path).write_text(text)
        git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', f'change {path}')
        if repo == self.other:
            git(repo, 'push', '-q', 'origin', 'main')

    def run_pull(self):
        env = {**os.environ, 'JP_AUTOPULL_REPO': str(self.repo), 'JP_AUTOPULL_LOG': str(self.tmp / 'log'),
               'JP_AUTOPULL_STATE': str(self.tmp / 'state'), 'JP_AUTOPULL_NOTIFY_FILE': str(self.notices)}
        subprocess.run(['bash', str(SCRIPT)], check=True, env=env, capture_output=True)
        return self.notices.read_text().splitlines() if self.notices.exists() else []

    def test_a_clean_main_fast_forwards_and_says_restart_for_app_code(self):
        self.commit('desktop/lib/x.js', 'x')
        notices = self.run_pull()
        self.assertEqual(git(self.repo, 'rev-parse', 'HEAD'), git(self.origin, 'rev-parse', 'main'))
        self.assertIn('restart the app', notices[-1])

    def test_a_window_only_change_says_reload_and_a_docs_change_nothing(self):
        self.commit('desktop/renderer/a.js', 'a')
        self.assertIn('⌘R', self.run_pull()[-1])
        self.commit('docs/a.md', 'a')
        self.assertIn('nothing to restart', self.run_pull()[-1])

    def test_untracked_files_do_not_stop_an_update(self):
        (self.repo / 'scratch.txt').write_text('mine')
        self.commit('docs/b.md', 'b')
        self.run_pull()
        self.assertEqual(git(self.repo, 'rev-parse', 'HEAD'), git(self.origin, 'rev-parse', 'main'))
        self.assertEqual((self.repo / 'scratch.txt').read_text(), 'mine')

    def test_the_class_of_unsafe_states_is_skipped_and_said_once(self):
        before = git(self.repo, 'rev-parse', 'HEAD')
        (self.repo / 'README.md').write_text('edited by the owner')
        self.commit('docs/c.md', 'c')
        first, second = self.run_pull(), self.run_pull()
        self.assertEqual(git(self.repo, 'rev-parse', 'HEAD'), before, 'a dirty tree is never touched')
        self.assertEqual((self.repo / 'README.md').read_text(), 'edited by the owner')
        self.assertEqual(len(second), len(first), 'the same skip is said once')
        self.assertIn('modified tracked files', first[-1])
        git(self.repo, 'checkout', '-q', 'README.md')
        git(self.repo, 'switch', '-q', '-c', 'other')
        self.assertIn('on branch other', self.run_pull()[-1])
        git(self.repo, 'switch', '-q', 'main')
        git(self.repo, 'switch', '-q', '--detach')
        self.assertIn('detached HEAD', self.run_pull()[-1])
        git(self.repo, 'switch', '-q', 'main')
        self.commit('local.txt', 'local', repo=self.repo)
        self.assertIn('not a fast-forward', self.run_pull()[-1])
        self.assertNotEqual(git(self.repo, 'rev-parse', 'HEAD'), git(self.origin, 'rev-parse', 'main'))


if __name__ == '__main__':
    unittest.main()
