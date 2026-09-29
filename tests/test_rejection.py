import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import mail, rejection
from src.notion import ledger
from tests.test_mail import FakeClient, FakeGoogle, FakeTracker, NOW, app, email, result


def verdict(kind='Hard skills', improve=('Add a Postgres replication bullet',)):
    return {'verdict': kind, 'confidence': 'medium', 'stage_reached': 'CV screen (no call)',
            'summary': 'The role needs deep Postgres internals.', 'evidence': ['Posting: "5+ years Postgres"'],
            'improve': list(improve)}


class Client:
    def __init__(self, answer):
        self.answer, self.calls, self.messages = answer, [], self

    def create(self, **params):
        self.calls.append(params)
        return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps(self.answer))],
                               usage=SimpleNamespace(input_tokens=9000, output_tokens=400, cache_read_input_tokens=0,
                                                     cache_creation_input_tokens=0))


class Tracker(FakeTracker):
    def __init__(self, apps, events=(), record=None, fail_columns=False):
        super().__init__(apps, events)
        self.record, self.fail_columns, self.sections = record, fail_columns, {}

    def page_text(self, page_id=None):
        return '# Profile\nSRE, 8 years, Kubernetes, Prometheus.'

    def read_kit(self, page_id, heading):
        return self.record if heading == ledger.RECORD_HEADING else None

    def query_database(self, database_id, filter_=None):
        if database_id == 'events':
            return self.events
        if filter_ and filter_.get('property') == 'Company':
            return [a for a in self.apps if a['properties']['Company']['rich_text'][0]['plain_text'] == filter_['rich_text']['equals']]
        return super().query_database(database_id, filter_)

    def update_page(self, page_id, properties):
        if self.fail_columns and 'Rejection reason' in properties:
            raise RuntimeError('400: Rejection reason is not a property')
        super().update_page(page_id, properties)

    def replace_after_heading(self, page_id, heading, blocks):
        self.sections[(page_id, heading)] = blocks


RECORD = {'job': {'title': 'Staff SRE', 'description': 'We need 5+ years of Postgres internals.'},
          'answers': [{'question': 'Why us?', 'answer': 'I love observability.'}], 'cover_letter': 'Dear team',
          'match': {'Score': 72, 'Reason': 'strong SRE match, Postgres depth unclear'}}


class RejectionTests(unittest.TestCase):
    def test_material_has_the_posting_what_was_sent_the_timeline_and_the_email(self):
        row = app('p1', 'Grafana Labs', 'Staff SRE | Spain', stage='Rejected')
        events = [{
            'id': 'e1', 'properties': {'Kind': {'type': 'select', 'select': {'name': 'Rejected'}},
                                       'At': {'type': 'date', 'date': {'start': '2026-09-28T05:00:00Z'}},
                                       'Note': {'type': 'rich_text', 'rich_text': [{'plain_text': 'not moving forward'}]}}}]
        others = [row, app('p2', 'Grafana Labs', 'Staff SRE | Sweden', stage='Rejected')]
        with mock.patch.object(rejection, 'EVENTS_DATABASE_ID', 'events'):
            text = rejection.material(Tracker(others, events, RECORD), row, 'Subject: Your application\n\nNot moving forward.')
        for part in ('5+ years of Postgres', 'Q: Why us?', 'Dear team', 'strong SRE match', 'Rejected — not moving forward',
                     'Staff SRE | Sweden (Rejected)', '## Rejection email'):
            self.assertIn(part, text)
        bare = rejection.material(Tracker([row]), row)
        self.assertIn('No application record was kept', bare)

    def test_review_writes_the_verdict_on_the_application(self):
        row = app('p1', 'Canonical', 'Senior SRE', stage='Rejected')
        tracker, client = Tracker([row], record=RECORD), Client(verdict())
        result, line = rejection.review(tracker, row, client=client, model='claude-sonnet-5', stats={})
        self.assertIn('## Job posting', client.calls[0]['messages'][0]['content'])
        self.assertIn('SRE, 8 years', client.calls[0]['system'][0]['text'])
        props = tracker.updates[0][1]
        self.assertEqual(props['Rejection reason'], {'select': {'name': 'Hard skills'}})
        self.assertIn('Next time: Add a Postgres', props['Rejection lesson']['rich_text'][0]['text']['content'])
        section = tracker.sections[('p1', rejection.HEADING)]
        self.assertEqual(section[0]['type'], 'callout')
        self.assertIn('to_do', [b['type'] for b in section])
        self.assertIn('Hard skills (medium)', line)

    def test_not_on_you_has_nothing_to_improve_and_missing_columns_still_leave_the_page_section(self):
        row = app('p1', 'Grafana Labs', 'Staff SRE | Spain', stage='Rejected')
        tracker = Tracker([row], fail_columns=True)
        result, _ = rejection.review(tracker, row, client=Client(verdict(rejection.NOT_ON_YOU, ('ignored',))), stats={})
        self.assertEqual(result['improve'], [])
        texts = [b[b['type']]['rich_text'][0]['text']['content'] for b in tracker.sections[('p1', rejection.HEADING)]]
        self.assertIn('Nothing to improve here: they were looking for a different profile.', texts)

    def test_pending_needs_the_column_and_an_empty_value(self):
        done, todo, old_workspace = (app('a', 'A', 'x', stage='Rejected'), app('b', 'B', 'y', stage='Rejected'),
                                     app('c', 'C', 'z', stage='Rejected'))
        done['properties']['Rejection reason'] = {'type': 'select', 'select': {'name': 'Unclear'}}
        todo['properties']['Rejection reason'] = {'type': 'select', 'select': None}
        self.assertEqual([r['id'] for r in rejection.pending(Tracker([done, todo, old_workspace]))], ['b'])


class GmailCheckTriggersTests(unittest.TestCase):
    def test_a_rejection_email_starts_a_review_with_the_email_text(self):
        with tempfile.TemporaryDirectory() as folder:
            apps = [app('p1', 'Scale AI', 'Infrastructure Engineer')]
            tracker, google = Tracker(apps), FakeGoogle([{**email('m1', 'Update on your application'), 'body': 'Scale AI: not moving forward'}])
            reviewed = []
            fake = lambda tracker, row, **kw: (reviewed.append((row['id'], kw['email_text'])) or ({}, '🛠 Why rejected · Scale AI'))
            stats = {}
            with mock.patch.object(rejection, 'review', fake), \
                    mock.patch('src.ai.interviews.stats_for_insights', lambda t: {'topics_answered_weakly': {}}):
                sent = []
                mail.run(tracker, google, client=FakeClient([[result(0, 0, 'Rejected', 'Not moving forward')]]), days=2,
                         send=sent.append, calendar=False, now=NOW, state_path=Path(folder) / 's.json', stats=stats)
            self.assertEqual(reviewed, [('p1', 'Subject: Update on your application\n\nScale AI: not moving forward')])
            self.assertIn('🛠 Why rejected · Scale AI', sent[0])
            self.assertIn('🛠 Why rejected · Scale AI', stats['updates'])

    def test_turned_off_it_does_nothing(self):
        with mock.patch.dict('os.environ', {'JOB_PILOTTO_DISABLE': 'rejection_review'}):
            self.assertEqual(mail.review_rejections(Tracker([]), None, [(app('p1', 'A', 'x'), email('m', 's'))], {}), [])


if __name__ == '__main__':
    unittest.main()
