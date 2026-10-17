"""The checks a PR shows carry their test layer's name (owner, 14 Oct 2026: "we still have `widget zoo`" after #753 renamed the workflows only):
every named job of a layer workflow says the layer's words, never an old name (widget zoo, a bare "replay shard" or "replay gate")."""
import re
import unittest
from pathlib import Path

WORKFLOWS = Path(__file__).resolve().parent.parent / '.github' / 'workflows'
LAYERS = {'control-tests.yml': 'control tests', 'page-cases.yml': 'page cases'}
OLD = re.compile(r'zoo|^replay shard|^replay gate|^replays to', re.I)


class LayerJobNamesTest(unittest.TestCase):
    def test_every_named_job_says_its_layer(self):
        for file, words in LAYERS.items():
            names = re.findall(r'^    name: (.+)$', (WORKFLOWS / file).read_text(), re.M)
            self.assertTrue(names, f'{file}: a named job')
            for name in names:
                self.assertIn(words, name, f'{file}: job "{name}" names its layer')
                self.assertNotRegex(name, OLD, f'{file}: job "{name}" uses an old name')


if __name__ == '__main__':
    unittest.main()
