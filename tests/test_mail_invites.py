"""Recruiter calendar invitations by email (Huxley, 30 Sep 2026): a second invite, the .ics time, the spend-limit path.
Guards src/ai/mail_inbox.py with src/sources/google.py. See also test_mail.py."""
import base64
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import mail
from src.notion import ledger
from src.sources import google as google_api
from tests import zone
from tests.mail_fakes import FakeClient, FakeGoogle, FakeTracker, app, email, event_row, result, text

setUpModule, tearDownModule = zone.pinned()


class HuxleyFirstInviteTests(unittest.TestCase):
    """30 Sep 2026: Huxley's second invitation (1 Oct 08:30 Zurich, message 1a0f12c88badf86c) arrived ~19 h after the
    first (30 Sep 08:30, message 1a0ed2a0b8f85171). Classified "Interview scheduled", it was taken for the first one."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.state = Path(self.tmp.name) / 'state.json'

    def tearDown(self):
        self.tmp.cleanup()

    def test_a_second_invite_within_a_day_of_the_first_is_a_new_interview(self):
        job = app('huxley', '', 'Principal SRE - Remote opportunity for a global AI company', stage='Interview scheduled',
                  via='Huxley', contact='Jayantie Nejati · j.nejati@huxley.com', applied='2026-09-29')
        job['properties']['Next interview'] = {'type': 'date', 'date': {'start': '2026-09-30T08:30:00+02:00'}}
        old = event_row('huxley', 'Interview scheduled', '2026-09-29T14:35:00+02:00', '1a0ed2a0b8f85171')
        old['properties']['Changes'] = text(json.dumps({'fields': {}, 'interview_at': '2026-09-30T08:30:00+02:00'}))
        tracker = FakeTracker([job], [old])
        invite = {**email('1a0f12c88badf86c', 'Follow up Igor / Jaya - SRE', '2026-09-30T09:17:02+02:00',
                          sender='"Seosahai - Nejati, Jayantie" <j.nejati@huxley.com>',
                          body='Hi Igor, does this time work for you? Microsoft Teams meeting'),
                  'invite_at': '2026-10-01T08:30:00+02:00'}
        client = FakeClient([[result(0, 0, 'Interview scheduled', company='Huxley')]])
        mail.run(tracker, FakeGoogle([invite]), client=client, calendar=False, state_path=self.state, stats={},
                 now=datetime(2026, 9, 30, 8, 0, tzinfo=timezone.utc))  # a manual check at 10:00 in Zurich
        [event] = [p for p in tracker.created if 'Kind' in p]
        self.assertEqual(event['Kind']['select']['name'], 'Interview scheduled')
        self.assertEqual(event['Source ID']['rich_text'][0]['text']['content'], '1a0f12c88badf86c')
        self.assertEqual([u['Next interview']['date']['start'] for page, u in tracker.updates if 'Next interview' in u],
                         ['2026-10-01T08:30:00+02:00'])
        self.assertFalse([u for _, u in tracker.updates if 'Stage' in u])  # stays Interview scheduled
        # The same invitation again (its event now in the ledger) is not a second event.
        tracker.events.append({'id': 'new-1', 'properties': {
            'Kind': {'select': {'name': 'Interview scheduled'}}, 'Source ID': text('1a0f12c88badf86c'),
            'At': {'date': {'start': '2026-09-30T09:17:02+02:00'}}, 'Application': {'relation': [{'id': 'huxley'}]}}})
        self.state.unlink()
        mail.run(tracker, FakeGoogle([invite]), client=FakeClient([]), calendar=False, state_path=self.state, stats={},
                 now=datetime(2026, 9, 30, 8, 0, tzinfo=timezone.utc))
        self.assertEqual(len([p for p in tracker.created if 'Kind' in p]), 1)


OUTLOOK_ICS = """BEGIN:VCALENDAR\r
METHOD:REQUEST\r
BEGIN:VTIMEZONE\r
TZID:W. Europe Standard Time\r
END:VTIMEZONE\r
BEGIN:VEVENT\r
SUMMARY:Follow up Igor / Jaya - SRE\r
DTSTART;TZID=W. Europe Standard Time:20261001T083000\r
DTEND;TZID=W. Europe Standard Time:20261001T090000\r
END:VEVENT\r
END:VCALENDAR\r
"""


class HuxleyFollowUpTests(unittest.TestCase):
    """30 Sep 2026: Huxley's second invitation (1 Oct 08:30 Zurich, message 1a0f12c88badf86c) arrived ~19 h after the
    first (30 Sep 08:30, message 1a0ed2a0b8f85171), and the Gmail check left the job on the old interview."""
    OLD, NEW = '1a0ed2a0b8f85171', '1a0f12c88badf86c'
    CHECK = datetime(2026, 9, 30, 8, 0, tzinfo=timezone.utc)  # a manual check at 10:00 in Zurich

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.state = Path(self.tmp.name) / 'state.json'
        self.job = app('huxley', '', 'Principal SRE - Remote opportunity for a global AI company', stage='Interview scheduled',
                       via='Huxley', contact='Jayantie Nejati · j.nejati@huxley.com', applied='2026-09-29')
        self.job['properties']['Next interview'] = {'type': 'date', 'date': {'start': '2026-09-30T08:30:00+02:00'}}
        old = event_row('huxley', 'Interview scheduled', '2026-09-29T14:35:00+02:00', self.OLD)
        old['properties']['Changes'] = text(json.dumps({'fields': {}, 'interview_at': '2026-09-30T08:30:00+02:00'}))
        self.tracker = FakeTracker([self.job], [old])

    def tearDown(self):
        self.tmp.cleanup()

    def invite(self):
        """The new email as Google.message reads it from Gmail: Outlook's .ics gives its start."""
        enc = lambda s: base64.urlsafe_b64encode(s.encode()).decode().rstrip('=')
        data = {'id': self.NEW, 'payload': {'mimeType': 'multipart/mixed', 'headers': [
            {'name': 'From', 'value': '"Seosahai - Nejati, Jayantie" <j.nejati@huxley.com>'},
            {'name': 'Subject', 'value': 'Follow up Igor / Jaya - SRE'},
            {'name': 'Date', 'value': 'Wed, 30 Sep 2026 07:17:02 +0000'}], 'parts': [
            {'mimeType': 'text/plain', 'body': {'data': enc('Hi Igor, does this time work for you? Microsoft Teams meeting')}},
            {'mimeType': 'text/calendar; method=REQUEST', 'body': {'data': enc(OUTLOOK_ICS)}}]}}
        with mock.patch.object(google_api.Google, 'get', lambda self_, url, params=None: data):
            return google_api.Google.message(object.__new__(google_api.Google), self.NEW)

    def check(self, client):
        stats = {}
        mail.run(self.tracker, FakeGoogle([self.invite()]), client=client, calendar=False, now=self.CHECK,
                 state_path=self.state, stats=stats)
        return stats

    def next_interview(self):
        return [u['Next interview']['date']['start'] for page, u in self.tracker.updates if page == 'huxley' and 'Next interview' in u]

    def test_the_invite_reads_the_outlook_time_in_zurich(self):
        self.assertEqual(self.invite()['invite_at'], '2026-10-01T08:30:00+02:00')

    def test_a_cancelled_invitation_has_no_interview_time(self):
        cancelled = OUTLOOK_ICS.replace('METHOD:REQUEST', 'METHOD:CANCEL')
        self.assertIsNone(google_api.invite_start(cancelled))
        self.assertIsNone(google_api.invite_start(OUTLOOK_ICS.replace('END:VEVENT', 'STATUS:CANCELLED\r\nEND:VEVENT')))

    def test_a_second_invite_within_a_day_of_the_first_is_a_new_interview(self):
        # The AI's own reading of the time is ignored: the .ics is the truth.
        self.check(FakeClient([[result(0, 0, 'Interview scheduled', company='Huxley', interview_at='2026-09-30T08:30:00+02:00')]]))
        self.assert_new_interview()

    def test_an_invite_asking_whether_the_time_works_is_an_interview_not_a_reply(self):
        # The owner's real check on 30 Sep: Haiku called it "Reply received" (it asks "does this time work?").
        self.check(FakeClient([[result(0, 0, ledger.REPLY, company='Huxley')]]))
        self.assert_new_interview()

    def assert_new_interview(self):
        [event] = [p for p in self.tracker.created if 'Kind' in p]
        self.assertEqual(event['Kind']['select']['name'], 'Interview scheduled')
        self.assertEqual(event['Source ID']['rich_text'][0]['text']['content'], self.NEW)
        self.assertEqual(json.loads(event['Changes']['rich_text'][0]['text']['content'])['interview_at'], '2026-10-01T08:30:00+02:00')
        self.assertEqual(self.next_interview(), ['2026-10-01T08:30:00+02:00'])
        self.assertFalse([u for page, u in self.tracker.updates if page == 'huxley' and 'Stage' in u])  # stays Interview scheduled

    def test_the_same_invite_again_is_not_a_second_event(self):
        client = FakeClient([[result(0, 0, 'Interview scheduled', company='Huxley')]])
        self.check(client)
        self.state.unlink()
        created = len(self.tracker.created)
        self.tracker.events.append({'id': 'new-1', 'properties': {
            'Kind': {'select': {'name': 'Interview scheduled'}}, 'Source ID': text(self.NEW), 'At': {'date': {'start': '2026-09-30T09:17:02+02:00'}},
            'Application': {'relation': [{'id': 'huxley'}]}}})
        self.check(FakeClient([]))
        self.assertEqual(len(self.tracker.created), created)

    def test_with_the_ai_spend_limit_reached_a_known_recruiters_invite_is_still_recorded(self):
        client = FakeClient([])
        with mock.patch.object(client, 'create', side_effect=RuntimeError('You have reached your specified API usage limits')):
            stats = self.check(client)
        self.assertEqual(self.next_interview(), ['2026-10-01T08:30:00+02:00'])
        self.assertEqual([p['Kind']['select']['name'] for p in self.tracker.created if 'Kind' in p], ['Interview scheduled'])
        self.assertIn(self.NEW, mail.load_state(self.state)['seen'])
        self.assertTrue(stats.get('updates'))

    def limited(self, emails):
        client = FakeClient([])
        with mock.patch.object(client, 'create', side_effect=RuntimeError('You have reached your specified API usage limits')):
            mail.run(self.tracker, FakeGoogle(emails), client=client, calendar=False, now=self.CHECK, state_path=self.state, stats={})

    def test_with_the_ai_spend_limit_reached_other_mail_waits_unread(self):
        stranger = {**email('x1', 'Team offsite', '2026-09-30T09:00:00+02:00', sender='friend@example.com',
                            body='Huxley Principal SRE'), 'invite_at': '2026-10-02T12:00:00+02:00'}
        update = email('x2', 'Your application', '2026-09-30T09:05:00+02:00', sender='j.nejati@huxley.com')  # no .ics
        self.limited([stranger, update])
        self.assertEqual((self.tracker.created, self.tracker.updates), ([], []))
        self.assertEqual(mail.load_state(self.state)['seen'], [])

    def test_with_the_ai_spend_limit_reached_a_contact_on_two_jobs_is_asked_not_guessed(self):
        other = app('huxley2', '', 'Staff Platform Engineer', stage='Screening', via='Huxley',
                    contact='Jayantie Nejati · j.nejati@huxley.com', applied='2026-09-30')
        self.tracker.apps.append(other)
        self.limited([self.invite()])
        [question] = self.tracker.created
        self.assertTrue(question['Needs you']['checkbox'])
        self.assertFalse([u for page, u in self.tracker.updates if 'Next interview' in u])


if __name__ == '__main__':
    unittest.main()
