import unittest
from datetime import datetime, timezone

from src.notion import runs

URL = 'https://job-boards.greenhouse.io/acme/jobs/42'


class RunPageTests(unittest.TestCase):
    def test_step_lines_show_offset_and_duration(self):
        started = datetime(2026, 9, 26, 1, 0, tzinfo=timezone.utc)
        steps = [{'name': 'map', 'at': '2026-09-26T01:00:05Z'}, {'name': 'fill', 'at': '2026-09-26T01:01:10Z'},
                 {'name': 'bad', 'at': 'not a date'}]
        self.assertEqual(runs.step_lines(steps, started), ['map · +0:05 (5 s)', 'fill · +1:10 (65 s)'])

    def test_run_page_links_job_and_never_carries_values(self):
        state = {'url': URL, 'status': 'needs_user', 'agent': 'claude', 'started_at': '2026-09-26T01:00:00+00:00',
                 'updated_at': '2026-09-26T01:03:00+00:00', 'minutes': 3.0, 'field_count': 2,
                 'unanswered': ['Why us?'], 'reason': 'empty required: Why us?', 'steps': []}
        result = {'fields': [{'label': 'First Name', 'observed': True, 'matches_source': True, 'required': True},
                             {'label': 'Why us?', 'observed': False, 'matches_source': False, 'required': True}],
                  'attachments': [{'label': 'Resume/CV', 'present': True}]}
        job = {'id': 'row-1', 'properties': {'Job': {'title': [{'plain_text': 'Staff SRE'}]},
                                             'Company': {'rich_text': [{'plain_text': 'Acme'}]}}}
        props, children = runs.run_page(state, result, job, 'Type + Return works for dropdowns')
        self.assertEqual(props['Run']['title'][0]['text']['content'], 'Acme · Staff SRE · Claude')
        self.assertEqual((props['Status']['select']['name'], props['ATS']['select']['name']), ('Needs input', 'Greenhouse'))
        self.assertEqual(props['Job']['relation'], [{'id': 'row-1'}])
        self.assertEqual(props['Unfilled required']['number'], 1)
        text = [c[c['type']]['rich_text'][0]['text']['content'] for c in children]
        self.assertIn('✓ First Name (required)', text)
        self.assertIn('CHECK Why us? (required)', text)
        self.assertIn('Type + Return works for dropdowns', text)
