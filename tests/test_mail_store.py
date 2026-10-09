"""The Gmail check on a store without Notion (the memory store, as sqlite runs it): emails move jobs, a question is an event
on no job, your replies and calendar interviews are events, and a second check writes nothing twice. The Notion side of the
same check is tests/test_mail*.py on the fakes in tests/mail_fakes.py."""
from datetime import timedelta
import io
import sys
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import mail
from src.stores import memory
from tests.mail_fakes import NOW, FakeClient, FakeGoogle, MailCase, email, result


class MailOnTheMemoryStoreTests(MailCase):
    def setUp(self):
        super().setUp()
        self.s = memory.open_store({})
        self.acme = self.s.applications.create({'url': 'https://x.test/acme', 'title': 'Senior SRE', 'company': 'Acme',
                                                'contact': 'Ana · ana@acme.test', 'applied_on': '2026-09-20'}, 'Applied')

    def run_check(self, google, results, calendar=False):
        sent = []
        with mock.patch('sys.stderr', new_callable=io.StringIO):
            summary = mail.run(None, google, client=FakeClient(results), days=2, send=sent.append, calendar=calendar, now=NOW,
                               state_path=self.state, stats={}, stores=self.s)
        return summary, sent

    def test_a_rejection_moves_the_job_and_is_recorded_once(self):
        google = FakeGoogle([email('m1', 'Your application at Acme')])
        summary, sent = self.run_check(google, [[result(0, 0, 'Rejected')]])
        self.assertIn('1 update(s)', summary)
        self.assertEqual(self.s.applications.get('https://x.test/acme')['stage'], 'Rejected')
        [event] = self.s.events.list(source_id='m1')
        self.assertEqual((event['app_id'], event['kind'], event['source']), (self.acme['id'], 'Rejected', 'Gmail'))
        self.assertEqual(event['changes']['fields']['Stage'], ['Applied', 'Rejected'])
        self.assertEqual(event['changes']['subject'], 'Your application at Acme')
        self.assertNotIn('Notion', ' '.join(sent))  # a store without pages links nowhere
        self.run_check(FakeGoogle([email('m1', 'Your application at Acme')]), [])
        self.assertEqual(len(self.s.events.list(source_id='m1')), 1)

    def test_an_email_about_no_known_job_is_a_question_on_no_job(self):
        google = FakeGoogle([email('m2', 'Thanks for applying to Zeta')])
        _, sent = self.run_check(google, [[result(0, -1, 'Confirmation received', company='Zeta')]])
        [question] = self.s.events.list(source_id='m2')
        self.assertEqual((question['app_id'], bool(question['needs_you'])), ('', True))
        self.assertEqual(question['changes']['subject'], 'Thanks for applying to Zeta')
        self.assertIn('Which job is this for?', sent[0])

    def test_your_reply_to_the_recruiter_is_a_replied_event(self):
        google = FakeGoogle([{**email('s1', 'Re: the role', sender='me@x.test'), 'to': 'Ana <ana@acme.test>', 'cc': '',
                              'labels': ['SENT']}])
        self.run_check(google, [[]])
        self.assertEqual([e['kind'] for e in self.s.events.list(app_id=self.acme['id'])], ['Replied'])

    def test_a_calendar_interview_moves_the_job_and_sets_next_interview(self):
        start = NOW + timedelta(days=2)
        event = {'id': 'c1', 'summary': 'Acme interview', 'created': NOW.isoformat(), 'start': {'dateTime': start.isoformat()},
                 'end': {'dateTime': (start + timedelta(hours=1)).isoformat()}}
        self.run_check(FakeGoogle(events=[event]), [], calendar=True)
        job = self.s.applications.get('https://x.test/acme')
        self.assertEqual((job['stage'], job['next_interview']), ('Interview scheduled', start.isoformat()))
        [scheduled] = self.s.events.list(source_id='cal:c1')
        self.assertEqual(scheduled['interview_at'], start.isoformat())
