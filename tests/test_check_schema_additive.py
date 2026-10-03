"""tools/check_schema_additive.py: what a beta may change in the Notion schema without making 'Back to stable' split someone's data."""
import copy
import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('check_schema_additive', ROOT / 'tools' / 'check_schema_additive.py')
check = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(check)

BASE = {'databases': {'DB': {'title': 'Job Tracker', 'former_titles': [], 'columns': {
    'Stage': {'type': 'select', 'options': [{'name': 'Applied'}, {'name': 'Interview'}]}, 'Notes': {'type': 'rich_text'}}, 'retired': ['Old']}},
    'pages': {'P': {'title': 'Profile'}}}


class AdditiveTests(unittest.TestCase):
    def candidate(self, edit):
        new = copy.deepcopy(BASE)
        edit(new)
        return check.breaks(BASE, new)

    def test_the_real_schema_is_additive_over_itself(self):
        real = json.loads((ROOT / 'config' / 'notion_schema.json').read_text())
        self.assertEqual(check.breaks(real, real), [])

    def test_adding_things_is_always_fine(self):
        def add(new):
            new['databases']['DB']['columns']['Fresh'] = {'type': 'number'}
            new['databases']['DB']['columns']['Stage']['options'].append({'name': 'Offer'})
            new['databases']['Other'] = {'title': 'New db', 'columns': {}}
            new['pages']['Q'] = {'title': 'New page'}
        self.assertEqual(self.candidate(add), [])

    def test_removing_or_retyping_breaks(self):
        self.assertIn("column 'Notes' was removed", ' '.join(self.candidate(lambda n: n['databases']['DB']['columns'].pop('Notes'))))
        self.assertIn('changed type', ' '.join(self.candidate(lambda n: n['databases']['DB']['columns']['Notes'].update(type='number'))))
        self.assertIn("lost option(s) ['Interview']", ' '.join(self.candidate(lambda n: n['databases']['DB']['columns']['Stage']['options'].pop())))
        self.assertIn('is gone', ' '.join(self.candidate(lambda n: n['databases'].pop('DB'))))
        self.assertIn('is gone', ' '.join(self.candidate(lambda n: n['pages'].pop('P'))))

    def test_a_rename_breaks_even_with_former_titles(self):
        def rename(new):
            new['databases']['DB']['title'] = 'Applications'
            new['databases']['DB']['former_titles'] = ['Job Tracker']
        self.assertIn('would not find it by that title', ' '.join(self.candidate(rename)))
        self.assertIn('renamed', ' '.join(self.candidate(lambda n: n['pages']['P'].update(title='CV'))))

    def test_retiring_a_column_in_this_build_breaks_but_one_stable_already_retired_is_fine(self):
        def retire(new):
            new['databases']['DB']['columns'].pop('Notes')
            new['databases']['DB']['retired'] = ['Old', 'Notes']
        self.assertIn('retired in this build', ' '.join(self.candidate(retire)))
        stable = copy.deepcopy(BASE)
        stable['databases']['DB']['columns']['Old'] = {'type': 'text'}
        stable['databases']['DB']['retired'] = ['Old']
        new = copy.deepcopy(BASE)   # 'Old' absent from columns, and listed retired in both
        self.assertEqual(check.breaks(stable, new), [])


if __name__ == '__main__':
    unittest.main()
