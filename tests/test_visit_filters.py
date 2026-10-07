"""'Filter for my search, then read' (7 Oct 2026): Claude picks filters among the page's own controls; anything else is dropped."""
import json
import unittest
from types import SimpleNamespace

from src.ai import visit_filters

SEARCH = {'role_keywords': ['photographe'], 'title_exclude_keywords': ['\\bintern\\b'], 'locations': {'top_tier': ['Genève'], 'country_wide': ['Suisse']}}
CONTROLS = [{'id': 'c1', 'kind': 'select', 'label': 'Date posted', 'options': ['Any time', 'Past month', 'Past week', 'Past 24 hours']},
            {'id': 'c2', 'kind': 'checkbox', 'label': 'Remote'}, {'id': 'c3', 'kind': 'text', 'label': 'Location'}]


class FakeClient:
    def __init__(self, answer):
        self.answer, self.asked = answer, []
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        self.asked.append(kwargs)
        return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps(self.answer))], usage=SimpleNamespace(input_tokens=10, output_tokens=5))


class PlanTest(unittest.TestCase):
    def test_only_listed_controls_known_actions_and_offered_options_survive(self):
        client = FakeClient({'why': 'Recent jobs in Geneva.', 'steps': [
            {'control': 'c1', 'action': 'select', 'value': 'Past week'}, {'control': 'c3', 'action': 'type', 'value': 'Genève'},
            {'control': 'c1', 'action': 'select', 'value': 'Past decade'}, {'control': 'apply-btn', 'action': 'click', 'value': ''},
            {'control': 'c2', 'action': 'submit', 'value': ''}]})
        planned = visit_filters.plan({'url': 'https://www.linkedin.com/jobs/search/', 'title': 'Jobs', 'controls': CONTROLS}, SEARCH, client=client)
        self.assertEqual([(s['control'], s['action'], s['value']) for s in planned['steps']], [('c1', 'select', 'Past week'), ('c3', 'type', 'Genève')])
        sent = client.asked[0]['messages'][0]['content']
        self.assertIn('photographe', sent)
        self.assertNotIn('\\\\b', sent, 'the user\'s words, not regex')

    def test_no_controls_no_call(self):
        client = FakeClient({})
        self.assertEqual(visit_filters.plan({'controls': []}, SEARCH, client=client)['steps'], [])
        self.assertEqual(client.asked, [])


if __name__ == '__main__':
    unittest.main()
