"""Real forms from the fill log keep only form wording: labels and kinds, never a value, a link or a contact detail."""
import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('fixture_from_fills', Path(__file__).resolve().parent.parent / 'tools' / 'fixture-from-fills.py')
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)


class SpecTest(unittest.TestCase):
    def test_required_fields_left_become_the_form_with_a_kind_each(self):
        run = {'ats': 'Greenhouse', 'trace': [
            {'label': 'First Name', 'required': 'yes', 'result': '✅ filled', 'why': ''},
            {'label': 'How did you hear about us?', 'required': 'yes', 'result': '⚠️ left', 'why': 'custom widget not readable'},
            {'label': 'Visa status', 'required': 'yes', 'result': '⚠️ left', 'why': 'no select option matched'},
            {'label': 'Describe a system you scaled and what broke first', 'required': 'yes', 'result': '⚠️ left', 'why': 'no answer in the kit'},
            {'label': 'I agree to the privacy policy', 'required': 'yes', 'result': '⚠️ left', 'why': 'legal/consent: left to you'},
            {'label': 'Contact me at ada@example.test', 'required': 'yes', 'result': '⚠️ left', 'why': 'no answer'},
            {'label': 'Pronouns', 'required': 'no', 'result': '⚠️ left', 'why': 'optional'},
            {'label': 'CV', 'required': 'yes', 'result': '⚠️ left', 'why': 'no file'},
            {'label': 'First Name', 'required': 'yes', 'result': '⚠️ left', 'why': 'no answer'},
            {'label': 'Visa status', 'required': 'yes', 'result': '⚠️ left', 'why': 'dropdown: no select option matched'},
            {'label': 'text-3219', 'required': 'yes', 'result': '⚠️ left', 'why': 'no answer'},
        ]}
        made = tool.spec_of(run)
        self.assertEqual(made['ats'], 'greenhouse')
        self.assertEqual([(f['label'], f['kind']) for f in made['fields']], [
            ('How did you hear about us?', 'widget'), ('Describe a system you scaled and what broke first', 'textarea'), ('Visa status', 'select')])   # tried twice: once
        self.assertTrue(made['id'].startswith('greenhouse-'))
        self.assertEqual(made, tool.spec_of(run), 'the same run gives the same file')

    def test_nothing_required_left_is_no_form(self):
        self.assertIsNone(tool.spec_of({'ats': 'Lever', 'trace': [{'label': 'Name', 'required': 'yes', 'result': '✅', 'why': ''}]}))


if __name__ == '__main__':
    unittest.main()
