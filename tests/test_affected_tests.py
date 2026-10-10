"""tools/affected-tests.py (9 Oct 2026): the local push check runs only the tests a change can break. These tests pin the rules that keep that
safe: imports (direct and through another module), text mentions, tree-scanning tests always, and "run everything" when nothing maps."""
import importlib.util
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('affected_tests', ROOT / 'tools/affected-tests.py')
affected = importlib.util.module_from_spec(spec)
spec.loader.exec_module(affected)


class AffectedTests(unittest.TestCase):
    def test_docs_alone_select_nothing(self):
        got = affected.select(['docs/x.md', 'README.md'])
        self.assertEqual([got[a] for a in ('python', 'desktop', 'worker', 'site')], [[], [], [], []])

    def test_dependency_and_unknown_files_run_everything(self):
        for f in ('desktop/package.json', 'requirements.txt', 'tests/test_0_notion_ids.py', 'something/new.bin', '.github/workflows/build.yml'):
            got = affected.select([f])
            self.assertEqual([got[a] for a in ('python', 'desktop', 'worker', 'site')], ['all'] * 4, f)

    def test_a_tool_script_selects_the_test_that_names_it(self):
        self.assertIn('test_ship', affected.select(['tools/ship.sh'])['python'])
        self.assertIn('test_pre_push_check', affected.select(['tools/pre-push-check.sh'])['python'])

    def test_an_engine_module_selects_every_test_that_imports_it_directly_or_through_another_module(self):
        got = set(affected.select(['src/ai/kit.py'])['python'])
        self.assertIn('test_kit', got)                      # imports it directly
        daily_tests = {p.stem for p in (ROOT / 'tests').glob('test_*.py') if re.search(r'^from src import daily\b|^import src\.daily\b', p.read_text(), re.M)}
        self.assertTrue(daily_tests, 'no test imports src.daily any more: pick another module that imports kit')
        self.assertLessEqual(daily_tests, got)              # daily imports kit, so the tests of daily are reached through it

    def test_a_desktop_lib_file_selects_the_tests_that_require_it_and_every_tree_scanner(self):
        picked = set(affected.select(['desktop/lib/files.js'])['desktop'])
        self.assertIn('test/files.test.js', picked)
        scanners = {f'test/{p.name}' for p in (ROOT / 'desktop/test').glob('*.test.js') if re.search(r'readdirSync|globSync', p.read_text())}
        self.assertTrue(scanners)
        self.assertLessEqual(scanners, picked)              # they read the whole tree: any change can break them

    def test_an_extension_change_selects_the_guards_that_scan_the_tree_through_an_imported_module(self):
        # 10 Oct 2026: 73ebe2b changed extension/ only; the version and page-words guards read the tree through scripts/extension-fingerprint.mjs and
        # tools/hardcoded-page-words.mjs (their own text has no scan call), were not picked, and main went red.
        picked = set(affected.select(['extension/fill-flow.js'])['desktop'])
        self.assertLessEqual({'test/extension-version.test.js', 'test/hardcoded-page-words.test.js'}, picked)

    def test_a_worker_change_runs_worker_tests_only(self):
        got = affected.select(['worker/src/report.js'])
        self.assertTrue(got['worker'])
        self.assertEqual((got['python'], got['site']), ([], []))

    def test_an_engine_file_no_test_reaches_runs_the_whole_python_suite(self):
        # The changed path alone, no file written: a temporary src/zz_... raced the shards that walk src/ (9 Oct 2026: red main twice).
        name = 'zz_' + 'orphan_nobody_names.py'          # built at run time: this file's own text must not name it
        self.assertFalse((ROOT / 'src' / name).exists())
        self.assertEqual(affected.select([f'src/{name}'])['python'], 'all')

    def test_no_test_writes_into_the_shared_src_folder(self):
        # Other shards read src/ while this one runs: a test that needs a file there makes it in a temporary copy instead.
        found = []
        for test in sorted((ROOT / 'tests').glob('test_*.py')):
            lines = test.read_text(encoding='utf-8').splitlines()
            src_vars = {m.group(1) for line in lines for m in [re.match(r"\s*(\w+)\s*=\s*ROOT\s*/\s*'src'", line)] if m}
            for number, line in enumerate(lines, 1):
                direct = re.search(r"ROOT\s*/\s*'src'.*\.(write_text|write_bytes|touch|mkdir)\(", line)
                via = any(re.search(rf"\b{var}\.(write_text|write_bytes|touch|mkdir)\(", line) for var in src_vars)
                if direct or via:
                    found.append(f'{test.name}:{number}')
        self.assertEqual(found, [])


if __name__ == '__main__':
    unittest.main()
