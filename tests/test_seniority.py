import json
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import enrich
from src.ai.seniority import from_title, settle


class SeniorityTitleTests(unittest.TestCase):
    def test_titles_state_their_level_in_several_languages(self):
        for title, level in [('Senior Site Reliability Engineer', 'senior'), ('Platform Engineer (Senior)', 'senior'), ('Sr. DevOps Engineer', 'senior'),
                             ('Staff SRE', 'staff_principal'), ('Staff Software Engineer', 'staff_principal'), ('Principal Platform Engineer', 'staff_principal'),
                             ('Lead SRE', 'lead_manager'), ('Tech Lead Platform', 'lead_manager'), ('Head of Infrastructure', 'lead_manager'),
                             ('Teamleiter DevOps (m/w/d)', 'lead_manager'), ('SRE (Junior)', 'junior'), ('Junior DevOps Engineer', 'junior'),
                             ('Praktikant Softwareentwicklung', 'junior'), ('DevOps Engineer (mid-level)', 'mid'), ('Senior Systems Administrator', 'senior')]:
            self.assertEqual((from_title(title) or (None,))[0], level, title)

    def test_the_same_word_with_another_meaning_states_nothing(self):
        for title in ['Staff Nurse', 'Lead Generation Specialist', 'Pastry Chef', 'Barista', 'Data Platform Engineer', 'Platform Engineer', 'Account Manager']:
            self.assertIsNone(from_title(title), title)

    def test_the_title_fills_unknown_and_lifts_to_staff_or_lead_but_never_lowers(self):
        unknown, senior = {'value': 'unknown', 'evidence': ''}, {'value': 'senior', 'evidence': 'x'}
        self.assertEqual(settle('Principal Platform Engineer', unknown)['value'], 'staff_principal')
        self.assertEqual(settle('Principal Platform Engineer', senior)['value'], 'staff_principal')
        self.assertEqual(settle('Lead SRE', senior)['value'], 'lead_manager')
        self.assertEqual(settle('Senior SRE', unknown), {'value': 'senior', 'evidence': 'Senior'})
        self.assertEqual(settle('Senior SRE', {'value': 'lead_manager', 'evidence': 'leads a team'})['value'], 'lead_manager')
        self.assertEqual(settle('Junior SRE', {'value': 'mid', 'evidence': '3 years'})['value'], 'mid')   # a lower title word does not override the posting
        self.assertEqual(settle('Platform Engineer', unknown), unknown)

    def test_extract_applies_it_to_what_the_model_returned(self):
        facts = {'languages': [], 'english_is_enough': {'value': 'unknown', 'evidence': ''}, 'seniority': {'value': 'unknown', 'evidence': ''},
                 'work_mode': {'value': 'unknown', 'remote_scope': '', 'evidence': ''}, 'workload': 'unknown', 'salary': {'stated': False, 'text': ''}}

        class Client:
            def __init__(self):
                self.messages = self

            def create(self, **params):
                from types import SimpleNamespace
                return SimpleNamespace(stop_reason='end_turn', content=[SimpleNamespace(type='text', text=json.dumps(facts))],
                                       usage=SimpleNamespace(input_tokens=1, output_tokens=1))
        data, _ = enrich.extract(Client(), 'claude-haiku-5-5', {'title': 'Staff SRE', 'company': 'A', 'location': '', 'description': 'x'})
        self.assertEqual(data['seniority']['value'], 'staff_principal')


if __name__ == '__main__':
    unittest.main()
