"""tools/recheck-needed.py (11 Oct 2026): after a refused push, ship.sh re-runs the push checks only when the commits that just landed can clash with this landing. The rule, the picker answers it reads and the doubt-means-check floor."""
import importlib.util
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('recheck_needed', ROOT / 'tools' / 'recheck-needed.py')
rn = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rn)


def picks(**areas):
    """A fake picker: files named in `areas` pick those tests; any other file picks nothing."""
    def select(files):
        out = {'python': [], 'desktop': [], 'worker': [], 'site': []}
        for f in files:
            for area, tests in areas.get(f, {}).items():
                out[area] = 'all' if tests == 'all' or out[area] == 'all' else sorted(set(out[area]) | set(tests))
        return out
    return select


class RecheckNeededTest(unittest.TestCase):
    def test_incoming_files_that_reach_no_test_of_mine_are_skipped(self):
        select = picks(**{'src/a.py': {'python': ['test_a']}, 'docs/x.md': {}})
        self.assertEqual(rn.decide(['src/a.py'], ['docs/x.md'], select)[0], False)

    def test_the_same_test_picked_by_both_sides_rechecks(self):
        select = picks(**{'src/a.py': {'python': ['test_a', 'test_b']}, 'src/b.py': {'python': ['test_b']}})
        recheck, why = rn.decide(['src/a.py'], ['src/b.py'], select)
        self.assertTrue(recheck, why)
        self.assertIn('test_b', why)

    def test_a_side_that_runs_the_whole_area_rechecks_when_the_other_runs_anything_there(self):
        select = picks(**{'src/a.py': {'python': ['test_a']}, 'package.json': {'python': 'all'}, 'src/b.py': {'desktop': ['x.test.js']}})
        self.assertTrue(rn.decide(['src/a.py'], ['src/c.py'], picks(**{'src/a.py': {'python': ['test_a']}, 'src/c.py': {'python': 'all'}}))[0])
        self.assertFalse(rn.decide(['src/a.py'], ['src/b.py'], select)[0], 'different areas: nothing in common')

    def test_a_file_both_sides_changed_rechecks_even_the_extension_manifest(self):
        # The version is stamped at build since 13 Oct 2026: a manifest both sides change is a real change (permissions, scripts).
        select = picks()
        self.assertTrue(rn.decide(['docs/x.md'], ['docs/x.md'], select)[0])
        self.assertTrue(rn.decide(['extension/manifest.json', 'docs/a.md'], ['extension/manifest.json', 'docs/b.md'], select)[0])

    def test_changes_to_the_checks_themselves_and_dependency_files_recheck(self):
        for f in ('tools/pre-push-check.sh', 'tools/affected-tests.py', 'tools/gate-cache.sh', '.github/workflows/build.yml', 'desktop/package-lock.json', 'requirements.txt'):
            with self.subTest(f=f):
                self.assertTrue(rn.decide(['docs/a.md'], [f], picks())[0])

    def test_both_sides_in_the_paths_the_slow_gates_read_recheck(self):
        self.assertTrue(rn.decide(['desktop/lib/a.js'], ['desktop/e2e/b.mjs'], picks())[0])
        self.assertFalse(rn.decide(['docs/a.md'], ['desktop/e2e/b.mjs'], picks())[0], 'only one side there')

    def test_a_failing_picker_rechecks(self):
        def boom(files):
            raise RuntimeError('x')
        self.assertTrue(rn.decide(['src/a.py'], ['src/b.py'], boom)[0])

    def test_the_command_line_answers_with_the_exit_code_ship_sh_reads(self):
        run = lambda *a: subprocess.run([sys.executable, '-I', str(ROOT / 'tools' / 'recheck-needed.py'), *a], capture_output=True, text=True)
        same = run('--mine', 'docs/x.md', '--incoming', 'docs/x.md')
        self.assertEqual((same.returncode, same.stdout.startswith('recheck: ')), (0, True), same.stdout + same.stderr)
        other = run('--mine', 'docs/x.md', '--incoming', 'docs/y.md')
        self.assertEqual((other.returncode, other.stdout.startswith('skip: ')), (1, True), other.stdout + other.stderr)


if __name__ == '__main__':
    unittest.main()
