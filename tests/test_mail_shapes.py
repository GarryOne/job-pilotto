"""The kinds of email the Gmail check meets in a real inbox, as synthetic copies.

The shapes were read from the emails the check had already registered for one real inbox (3 Oct 2026): an ATS saying thanks, the
same ATS saying "an update", a security code, a recruiter's LinkedIn reply, a calendar notification, a card receipt and a vendor's
usage alerts. Every name, company, address and number here is invented; only what decides the check's behaviour is kept (the
sender's kind, the subject's wording, the day, what the AI says about it). The AI is stubbed with the verdict a careful reader
gives, so these tests prove the logic around it: what is recorded, what moves the stage, what is never written twice, what is left
alone. Nothing is called out to Gmail, Notion or a model.
"""
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

from src.ai import mail
from src.notion import ledger
from tests import zone
from tests.test_mail import FakeClient, FakeGoogle, FakeTracker, app, email, event_row, result
from tests.mail_fakes import record_of

setUpModule, tearDownModule = zone.pinned()

NOW = datetime(2026, 9, 30, 16, 0, tzinfo=timezone.utc)
ATS = 'no-reply@us.greenhouse-mail.io'
LINKEDIN = 'messages-noreply@linkedin.com'


class ShapeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.state = Path(self.tmp.name) / 'state.json'

    def tearDown(self):
        self.tmp.cleanup()

    def check(self, apps, emails, verdicts, events=()):
        tracker, sent = FakeTracker(apps, events), []
        with mock.patch('src.ai.mail_calendar.interview_stats', lambda s: {}):
            mail.run(tracker, FakeGoogle(emails), client=FakeClient([verdicts]), days=2, send=sent.append, calendar=False,
                     now=NOW, state_path=self.state, stats={})
        return tracker, sent

    def kinds(self, tracker):
        return [row['Kind']['select']['name'] for row in tracker.created if 'Kind' in row]

    def test_an_ats_thank_you_is_a_confirmation_and_moves_the_stage_once(self):
        apps = [app('p1', 'Acme Labs', 'Senior Site Reliability Engineer', stage='Applied')]
        mails = [email('m1', 'Thank you for applying to Acme Labs', sender=ATS, body='We received your application for Senior Site Reliability Engineer.')]
        tracker, _ = self.check(apps, mails, [result(0, 0, 'Confirmation received', 'Application received', company='Acme Labs')])
        self.assertEqual(self.kinds(tracker), ['Confirmation received'])
        self.assertIn({'Stage': {'select': {'name': 'Confirmation received'}}}, [{'Stage': props['Stage']} for _, props in tracker.updates if 'Stage' in props])

    def test_the_same_ats_writing_three_times_in_a_row_records_one_confirmation(self):
        # "Your application for Acme Labs" arrived on three consecutive mornings; the second and third say the same thing.
        apps = [app('p1', 'Acme Labs', 'Senior Site Reliability Engineer', stage='Applied')]
        mails = [email(f'm{n}', 'Your application for Acme Labs', sender=ATS, date=f'2026-09-{27 + n}T09:00:00+02:00') for n in range(3)]
        tracker, _ = self.check(apps, mails, [result(i, 0, 'Confirmation received', 'Application received', company='Acme Labs') for i in range(3)],
                                events=[event_row('p1', 'Confirmation received', '2026-09-27T09:00:00+02:00')])
        self.assertLessEqual(self.kinds(tracker).count('Confirmation received'), 1, self.kinds(tracker))

    def test_an_update_on_your_application_that_says_no_is_a_rejection(self):
        apps = [app('p1', 'Acme Labs', 'Senior Site Reliability Engineer', stage='Confirmation received')]
        mails = [email('m1', 'An update on your application to Acme Labs - Senior Site Reliability Engineer', sender=ATS,
                       body='After careful consideration we will not be moving forward with your application.')]
        tracker, sent = self.check(apps, mails, [result(0, 0, 'Rejected', 'Not moving forward', company='Acme Labs')])
        self.assertEqual(self.kinds(tracker), ['Rejected'])
        self.assertIn(('p1', {'Stage': {'select': {'name': 'Rejected'}}}), tracker.updates)
        self.assertTrue(any('Acme Labs' in line for line in sent))

    def test_a_security_code_for_an_application_changes_nothing(self):
        apps = [app('p1', 'Acme Labs', 'Senior Site Reliability Engineer', stage='Applied')]
        mails = [email('m1', 'Security code for your application to Acme Labs', sender=ATS, body='Your security code is 000000. Do not share it.')]
        tracker, sent = self.check(apps, mails, [result(0, 0, 'Other', 'A one-time code', relevant=False, company='Acme Labs')])
        self.assertEqual((tracker.created, [u for u in tracker.updates if 'Stage' in u[1]], sent), ([], [], []))

    def test_receipts_and_vendor_usage_alerts_are_left_alone(self):
        apps = [app('p1', 'Acme Labs', 'Senior Site Reliability Engineer', stage='Applied')]
        mails = [email('m1', 'Your receipt from Example Cafe #000000', sender='receipts@cafe.example'),
                 email('m2', 'Monthly API Spend Exceeding Thresholds', sender='billing@vendor.example'),
                 email('m3', "You've used 90% of your organization's monthly API spend limit", sender='billing@vendor.example'),
                 email('m4', 'Your API prompt cache hit rate is low', sender='billing@vendor.example')]
        tracker, sent = self.check(apps, mails, [result(i, -1, 'Other', 'not about an application', relevant=False, company='') for i in range(4)])
        self.assertEqual((tracker.created, [u for u in tracker.updates if 'Stage' in u[1]], sent), ([], [], []))

    def test_two_linkedin_replies_are_two_emails_each_logged_once_and_never_again(self):
        # LinkedIn sent "Message replied" twice the same morning. Each email is its own event (the message id is the key); a second check adds nothing.
        apps = [app('p1', '', 'Principal SRE', stage='Recruiter lead', via='Example Talent')]
        mails = [email(f'm{n}', 'Message replied: Principal SRE - Remote opportunity for a global AI company', sender=LINKEDIN,
                       body='Example Talent replied to your message about the Principal SRE role.', date=f'2026-09-29T0{n + 8}:00:00+02:00') for n in range(2)]
        tracker, _ = self.check(apps, mails, [result(i, 0, ledger.REPLY, 'The recruiter answered') for i in range(2)])
        ids = [row['Source ID']['rich_text'][0]['text']['content'] for row in tracker.created if 'Source ID' in row]
        self.assertEqual(sorted(ids), ['m0', 'm1'])
        again, _ = self.check(apps, mails, [])
        self.assertEqual(again.created, [])

    def test_a_calendar_notification_for_a_known_contact_sets_the_interview(self):
        apps = [app('p1', 'Acme Labs', 'SRE', stage='Screening', contact='recruiter@example-agency.test')]
        mails = [email('m1', 'Notification: Connect Alex / Sam - SRE @ Thu 1 Oct 2026 08:30 - 09:00 (CEST)', sender='calendar-notification@google.com',
                       body='Acme Labs: Alex / Sam - SRE. When: Thu 1 Oct 2026 08:30 - 09:00')]
        tracker, _ = self.check(apps, mails, [result(0, 0, 'Interview scheduled', 'Intro call', interview_at='2026-10-01T08:30:00+02:00', company='Acme Labs')])
        self.assertEqual(self.kinds(tracker), ['Interview scheduled'])
        self.assertTrue(any('Next interview' in props for _, props in tracker.updates), tracker.updates)

    def test_an_email_that_names_none_of_your_jobs_is_a_question_not_a_guess(self):
        # The AI picked job 0, but nothing in the email names that employer, role or recruiter: the check asks in Focus instead of writing to the wrong job.
        apps = [app('p1', 'Acme Labs', 'Senior Site Reliability Engineer', stage='Applied')]
        mails = [email('m1', 'Following up', sender='someone@unrelated-agency.test', body='Hello, are you open to a new role?')]
        tracker, sent = self.check(apps, mails, [result(0, 0, ledger.REPLY, 'A reply', company='Unrelated Agency')])
        self.assertTrue(tracker.created and tracker.created[0].get('Needs you', {}).get('checkbox'), tracker.created)
        self.assertEqual([u for u in tracker.updates if 'Stage' in u[1]], [])

    def test_the_search_catches_every_sender_kind_that_is_about_an_application(self):
        query = mail.query([record_of(app('p1', 'Acme Labs', 'SRE'))], 2)
        for part in ('from:greenhouse-mail.io', '"Acme Labs"'):
            self.assertIn(part, query)


if __name__ == '__main__':
    unittest.main()
