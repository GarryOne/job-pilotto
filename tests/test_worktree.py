"""tools/worktree.sh: a new worktree is ready to test at once, from main or another base (9 Oct 2026: release lanes made theirs with a bare
`git worktree add`, got no Python .venv, and every API-engine step died with "No module named 'anthropic'"). Run on a throwaway origin."""
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PACKAGES = ('.venv', 'desktop/node_modules', 'desktop/e2e/node_modules', 'worker/node_modules', 'site/node_modules')


def git(cwd, *args):
    return subprocess.run(['git', *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


class WorktreeTest(unittest.TestCase):
    def setUp(self):
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp, True)
        origin, self.main = tmp / 'origin.git', tmp / 'main'
        subprocess.run(['git', 'init', '-q', '--bare', '-b', 'main', str(origin)], check=True)
        (self.main / 'tools').mkdir(parents=True)
        shutil.copy(ROOT / 'tools' / 'worktree.sh', self.main / 'tools' / 'worktree.sh')
        (self.main / '.gitignore').write_text('.venv\nnode_modules\n.claude/\n')
        for name in ('desktop', 'desktop/e2e', 'worker', 'site'):
            (self.main / name).mkdir(parents=True, exist_ok=True)
            (self.main / name / 'keep.txt').write_text(name)
        git(self.main, 'init', '-q', '-b', 'main')
        for key, value in (('user.email', 't@example.com'), ('user.name', 'Test')):
            git(self.main, 'config', key, value)
        git(self.main, 'add', '-A')
        git(self.main, 'commit', '-qm', 'Start')
        git(self.main, 'checkout', '-qb', 'release/x')
        (self.main / 'release.txt').write_text('release\n')
        git(self.main, 'add', '-A')
        git(self.main, 'commit', '-qm', 'Release only')
        git(self.main, 'checkout', '-q', 'main')
        git(self.main, 'remote', 'add', 'origin', str(origin))
        git(self.main, 'push', '-q', 'origin', 'main', 'release/x')
        for package in PACKAGES:   # what the main checkout has installed
            (self.main / package).mkdir(parents=True)

    def make(self, *args):
        done = subprocess.run(['sh', str(self.main / 'tools' / 'worktree.sh'), *args], cwd=self.main, capture_output=True, text=True)
        self.assertEqual(done.returncode, 0, done.stderr)
        return Path(done.stdout.strip())

    def assert_linked(self, tree):
        for package in PACKAGES:
            with self.subTest(package=package):
                self.assertTrue((tree / package).is_symlink(), f'{package} is not linked')
                self.assertEqual((tree / package).resolve(), (self.main / package).resolve())
        self.assertEqual(git(tree, 'status', '--porcelain'), '', 'the links are git-ignored')

    def test_from_main_every_package_is_linked(self):
        tree = self.make('topic')
        self.assert_linked(tree)
        self.assertFalse((tree / 'release.txt').exists())

    def test_from_another_base_it_starts_there_with_the_same_links(self):
        tree = self.make('lane', 'origin/release/x')
        self.assert_linked(tree)
        self.assertTrue((tree / 'release.txt').exists(), 'the worktree starts from the base it was given')
        self.assertEqual(git(tree, 'rev-parse', '--abbrev-ref', 'HEAD'), 'lane')


if __name__ == '__main__':
    unittest.main()
