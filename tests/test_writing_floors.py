"""The code floors under written text (src/ai/writing_floors.py): no letter for a ruled-out job, and unsupported figures flagged."""
import unittest

from src.ai import writing_floors as floors
from src.ai.writing_rules import RULES

GROUND = "Alex has 8 years on Kubernetes; led a migration that cut alert noise by 60%. Minimum CHF 130,000 a year. Notice: 2 months."


class Floors(unittest.TestCase):
    def test_figures_normalised(self):
        self.assertEqual(floors.figures('60% and CHF 130,000, 5 teams'), ['60', '130000'])

    def test_supported_figures_pass_and_new_ones_are_flagged(self):
        self.assertEqual(floors.unsupported_figures('I cut noise by 60% and expect 130k.', GROUND), [])
        self.assertEqual(floors.unsupported_figures('I led 25 engineers and saved 40%.', GROUND), ['25', '40'])

    def test_ruled_out_job_gets_no_letter_and_no_drafted_text(self):
        kit = {'eligible': False, 'eligibility_note': 'Not a match: it is a nursing job.', 'cover_letter': 'Dear team, patient care aligns...',
               'answers': [{'category': 'normal', 'answer': 'Patient care aligns.', 'needs_review': False}, {'category': 'contact', 'answer': 'a@b.c', 'needs_review': False}], 'check_before_sending': []}
        floors.kit_floors(kit, GROUND)
        self.assertEqual(kit['cover_letter'], '')
        self.assertEqual(kit['eligibility_note'], 'Not a match: it is a nursing job.')
        self.assertEqual([(a['answer'], a['needs_review']) for a in kit['answers']], [('', True), ('a@b.c', False)])

    def test_note_gets_the_prefix_once(self):
        kit = {'eligible': False, 'eligibility_note': 'Fluent French is required', 'cover_letter': 'x', 'answers': []}
        floors.kit_floors(kit, GROUND)
        self.assertEqual(kit['eligibility_note'], 'Not a match: Fluent French is required.')

    def test_letter_loses_salary_and_unsupported_figures_but_keeps_the_rest(self):
        kit = {'eligible': True, 'cover_letter': "I run Kubernetes. My salary expectation is CHF 130,000.\nI led 25 engineers. I cut noise by 60%.", 'check_before_sending': [],
               'answers': [{'category': 'normal', 'answer': 'We saved 40%. I like SRE.', 'needs_review': False}, {'category': 'normal', 'answer': 'Noise down 60%.', 'needs_review': False}]}
        floors.kit_floors(kit, GROUND)
        self.assertEqual(kit['cover_letter'], 'I run Kubernetes.\nI cut noise by 60%.')
        self.assertEqual([(a['answer'], a['needs_review']) for a in kit['answers']], [('I like SRE.', True), ('Noise down 60%.', False)])
        self.assertIn('left out', kit['check_before_sending'][0])

    def test_a_clean_letter_is_untouched_and_adds_no_check(self):
        kit = {'eligible': True, 'cover_letter': 'I run Kubernetes.\n\nAlex', 'answers': [], 'check_before_sending': []}
        floors.kit_floors(kit, GROUND)
        self.assertEqual(kit['check_before_sending'], [])

    def test_scrub_drops_sentences_and_empty_items_in_any_structure(self):
        value, dropped = floors.scrub({'a': ['Cut noise by 60%. Saved 40%.', 'Saved 70%.'], 'b': {'c': 'Fine.'}, 'd': True}, GROUND)
        self.assertEqual(value, {'a': ['Cut noise by 60%.'], 'b': {'c': 'Fine.'}, 'd': True})
        self.assertEqual(dropped, 2)

    def test_rules_block_exists(self):
        self.assertIn('first person', RULES)


if __name__ == '__main__':
    unittest.main()
