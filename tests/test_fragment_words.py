"""The Python twin of desktop/renderer/fragment-words.js reads every pattern shape as the JS rule does (no quotes, no regex syntax on screen)."""
import json
import re
import subprocess
import unittest
from pathlib import Path

from src.fragment_words import fragment_names

ROOT = Path(__file__).resolve().parent.parent


class FragmentWordsTest(unittest.TestCase):
    def test_python_reads_every_case_of_the_js_test_the_same(self):
        source = (ROOT / 'desktop/test/fragment-words.test.js').read_text()
        block = source[source.index('const SHAPES = ['):source.index('];', source.index('const SHAPES = ['))]
        cases = re.findall(r"\['((?:[^'\\]|\\.)*)', (\[[^\]]*\])\]", block)
        self.assertGreater(len(cases), 10)
        for raw, names in cases:
            pattern = raw.encode().decode('unicode_escape').encode('latin-1').decode('utf-8')
            self.assertEqual(fragment_names(pattern), json.loads(names.replace("'", '"')), pattern)

    def test_strategy_chips_use_it(self):
        from src.desktop_strategy import _readable
        self.assertEqual(_readable('"tax"'), 'tax')
        self.assertEqual(_readable('\\bz[uü]rich\\b'), 'zürich')


if __name__ == '__main__':
    unittest.main()
