"""Every GitHub action the workflows use runs on Node 24: an older major makes GitHub warn on every job ("Node.js 20 is deprecated").

3 Oct 2026: all actions were moved to their Node 24 majors (4551390); within hours new workflow steps brought back upload-artifact@v4
and setup-node@v4 by copying an older step, and the warning was back on the fixer's page.
"""
import pathlib
import re
import unittest

WORKFLOWS = pathlib.Path(__file__).resolve().parent.parent / '.github' / 'workflows'
# The first major of each action that runs on Node 24 (read from its action.yml `runs.using`).
NODE24 = {'actions/checkout': 5, 'actions/setup-node': 5, 'actions/setup-python': 6, 'actions/cache': 5, 'actions/cache/restore': 5,
          'actions/cache/save': 5, 'actions/upload-artifact': 6, 'actions/download-artifact': 7, 'actions/github-script': 8,
          'actions/attest-build-provenance': 3}


class Node24Actions(unittest.TestCase):
    def test_no_action_runs_on_node_20(self):
        old = []
        for path in sorted(WORKFLOWS.glob('*.yml')):
            for number, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
                match = re.search(r'uses:\s*(actions/[\w./-]+)@v(\d+)', line)
                if match and match.group(1) in NODE24 and int(match.group(2)) < NODE24[match.group(1)]:
                    old.append(f'{path.name}:{number} {match.group(1)}@v{match.group(2)} (use v{NODE24[match.group(1)]})')
        self.assertEqual(old, [], 'actions on Node 20 (GitHub warns on every job): ' + '; '.join(old))


if __name__ == '__main__':
    unittest.main()
