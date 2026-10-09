"""A form fill's run in the store (src/ai/apply_record.py): the spec's shape, one record per session, learnings back."""
import unittest
from unittest import mock

from src.ai import apply_record
from src.stores import memory

URL = 'https://boards.greenhouse.io/acme/jobs/1'
STATE = {'url': URL, 'agent': 'claude', 'status': 'needs_user', 'reason': 'empty required: Salary',
         'started_at': '2026-10-09T19:40:00+00:00', 'updated_at': '2026-10-09T19:47:00+00:00', 'minutes': 4,
         'field_count': 3, 'unanswered': ['Salary'], 'billed_to': 'Claude subscription', 'tokens_total': 900, 'tokens_output': 120,
         'steps': [{'name': 'open form', 'at': '2026-10-09T19:40:02+00:00'}, {'name': 'fill', 'at': '2026-10-09T19:42:12.500+00:00'}]}
RESULT = {'fields': [{'label': 'Email', 'required': True, 'source': 'profile', 'observed': True, 'matches_source': True, 'value': 'me@x'},
                     {'label': 'Salary', 'required': True, 'source': '', 'observed': False, 'matches_source': False}],
          'attachments': [{'label': 'Resume', 'present': True}, {'label': 'Cover letter', 'present': False}]}


class ApplyRecordTests(unittest.TestCase):
    def test_the_record_is_the_specs_shape_without_any_answer(self):
        made = apply_record.record(STATE, RESULT, {'id': 'app-1', 'company': 'Acme'}, 'Salary is free text here')
        data = made['fields']['data']
        self.assertEqual((made['url'], made['ats'], made['learnings']), (URL, 'Greenhouse', 'Salary is free text here'))
        self.assertEqual(data['fields'][0], {'label': 'Email', 'required': True, 'source': 'profile', 'outcome': 'filled',
                                             'confidence': '', 'reason': ''})
        self.assertEqual(data['fields'][1]['outcome'], 'check')
        self.assertEqual((data['left_for_you'], data['attachments']), (['Salary'], ['Resume']))
        self.assertEqual(data['steps'], [{'step': 'open form', 'ms': 2000}, {'step': 'fill', 'ms': 130500}])
        self.assertNotIn('me@x', repr(made), 'never the person\'s answers')
        self.assertEqual((made['fields']['job'], made['fields']['company'], made['fields']['agent']), ('app-1', 'Acme', 'Claude'))

    def test_on_this_macs_store_the_apps_session_record_is_updated_not_doubled(self):
        stores = memory.open_store()
        stores.applications.create({'url': URL, 'title': 'SRE', 'company': 'Acme'}, 'Applying')
        session = stores.agent_runs.add({'url': URL, 'ats': 'Claude', 'outcome': 'Open', 'fields': {'turns': 12}})
        with mock.patch.object(stores.agent_runs, 'list', return_value=[{**session, 'created_at': STATE['started_at']}],
                               wraps=stores.agent_runs.list):
            apply_record.log(stores, STATE, RESULT, 'a learning')
        runs = stores.agent_runs.list()
        self.assertEqual(len(runs), 1)
        self.assertEqual((runs[0]['ats'], runs[0]['fields']['turns'], runs[0]['learnings']), ('Claude', 12, 'a learning'))
        self.assertEqual(runs[0]['fields']['data']['left_for_you'], ['Salary'])

    def test_a_codex_run_or_a_notion_store_adds_its_own_record(self):
        stores = memory.open_store()
        link = apply_record.log(stores, dict(STATE, agent='codex'), RESULT)
        self.assertTrue(link)
        self.assertEqual([r['ats'] for r in stores.agent_runs.list()], ['Greenhouse'])

    def test_a_store_that_refuses_never_fails_the_run(self):
        stores = memory.open_store()
        stores.agent_runs.add = mock.Mock(side_effect=RuntimeError('down'))
        self.assertIsNone(apply_record.log(stores, dict(STATE, agent='codex'), RESULT))

    def test_learnings_come_back_newest_first_by_board(self):
        stores = memory.open_store()
        apply_record.log(stores, dict(STATE, agent='codex'), RESULT, 'older')
        apply_record.log(stores, dict(STATE, agent='codex', url='https://jobs.lever.co/beta/1'), RESULT, 'lever one')
        found = apply_record.learnings(stores, 'Greenhouse')
        self.assertEqual([(ats, text) for _, ats, _, _, text in found], [('Greenhouse', 'older')])
        self.assertEqual(len(apply_record.learnings(stores)), 2)


if __name__ == '__main__':
    unittest.main()
