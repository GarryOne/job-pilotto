"""The Calendar pass: matching events, prep messages and the transcript nudge (src/ai/mail_calendar.py).
See also test_mail.py."""
from datetime import timedelta
import io
from pathlib import Path
import sys
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tests import zone
from tests.mail_fakes import NOW, FakeGoogle, FakeTracker, MailCase, app, email

setUpModule, tearDownModule = zone.pinned()


class MailCalendarTests(MailCase):
    def test_calendar_match_by_contact_email_sets_interview_and_sends_prep_once(self):
        start = NOW + timedelta(hours=20)  # tomorrow 14:00 in Zurich
        event = {'id': 'e1', 'status': 'confirmed', 'summary': 'Screening Call between Alex Morgan and Sam Taylor',
                 'created': '2026-09-26T10:00:00Z', 'hangoutLink': 'https://meet.test/x',
                 'start': {'dateTime': start.isoformat()}, 'end': {'dateTime': (start + timedelta(minutes=30)).isoformat()},
                 'attendees': [{'email': 'alex@yupe.io', 'displayName': 'Alex Morgan'}, {'email': 'me@x', 'self': True}]}
        apps = [app('p1', 'Zephyr AI', 'Infrastructure Engineer', stage='Screening', via='TechTree',
                    contact='Jan (TechTree) · jan@techtree.dev; Alex Morgan · alex@yupe.io')]
        tracker, google = FakeTracker(apps), FakeGoogle(events=[event])
        _, sent = self.run_mail(tracker, google, [], calendar=True)
        created = tracker.created[0]
        self.assertEqual((created['Kind']['select']['name'], created['Source']['select']['name']), ('Interview scheduled', 'Calendar'))
        self.assertEqual(dict(tracker.updates)['p1']['Next interview'], {'date': {'start': start.isoformat()}})
        prep = [m for m in sent if m.startswith('🗓 <b>Interview tomorrow')]
        self.assertEqual(len(prep), 1)
        self.assertIn('Postgres', prep[0])
        self.assertIn('With:</b> Alex Morgan', prep[0])
        _, sent = self.run_mail(tracker, google, [], calendar=True)
        self.assertFalse([m for m in sent if m.startswith('🗓 <b>Interview tomorrow')])  # once only

    def test_after_the_interview_asks_for_the_transcript(self):
        start = NOW - timedelta(hours=3)
        event = {'id': 'e2', 'summary': 'Zephyr AI technical interview', 'start': {'dateTime': start.isoformat()},
                 'end': {'dateTime': (start + timedelta(hours=1)).isoformat()}}
        tracker = FakeTracker([app('p1', 'Zephyr AI', 'Infrastructure Engineer')])
        _, sent = self.run_mail(tracker, FakeGoogle(events=[event]), [], calendar=True)
        self.assertTrue(any('How did' in m and 'transcript' in m for m in sent))

    def reviewed_run(self, related):
        start = NOW - timedelta(hours=3)
        event = {'id': 'e3', 'summary': 'AG Talent role discussion', 'start': {'dateTime': start.isoformat()},
                 'end': {'dateTime': (start + timedelta(hours=1)).isoformat()}}
        job = app('p1', 'AG Talent', 'Senior DevOps Engineer')
        review = {'id': 'r1', 'properties': {'Application': {'type': 'relation', 'relation': [{'id': related}]},
                                             'Date': {'type': 'date', 'date': {'start': start.date().isoformat()}}}}

        class Reviewed(FakeTracker):
            def query_database(self, database_id, filter_=None):
                return [review] if database_id == 'interviews-db' else super().query_database(database_id, filter_)

        with mock.patch('src.ai.interviews.INTERVIEWS_DATABASE_ID', 'interviews-db'):
            return self.run_mail(Reviewed([job]), FakeGoogle(events=[event]), [], calendar=True)[1]

    def test_after_the_interview_does_not_ask_when_a_review_is_already_saved(self):
        self.assertFalse([m for m in self.reviewed_run('p1') if 'How did' in m])

    def test_a_review_of_another_job_does_not_stop_the_nudge_and_the_caption_names_the_employer(self):
        asked = [m for m in self.reviewed_run('other') if 'How did' in m]
        self.assertEqual(len(asked), 1)
        self.assertIn('Caption:</b> AG Talent, AG Talent role', asked[0])


if __name__ == '__main__':
    unittest.main()
