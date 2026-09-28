import base64
import contextlib
import io
import json
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import mail
from src.notion import ledger
from src.sources import google as google_api

NOW = datetime(2026, 9, 26, 16, 0, tzinfo=timezone.utc)  # 18:00 in Zurich


def text(value):
    return {'type': 'rich_text', 'rich_text': [{'plain_text': value}]}


def app(page_id, company, job, stage='Applied', via='', contact='', applied='2026-09-26'):
    return {'id': page_id, 'url': f'https://notion.test/{page_id}', 'properties': {
        'Company': text(company), 'Job': {'type': 'title', 'title': [{'plain_text': job}]},
        'Stage': {'type': 'select', 'select': {'name': stage}}, 'Via': text(via), 'Contact': text(contact),
        'Applied on': {'type': 'date', 'date': {'start': applied}}, 'Next step': text(''),
        'Next interview': {'type': 'date', 'date': None}, 'Job URL': {'type': 'url', 'url': f'https://x.test/{page_id}'}}}


def event_row(page_id, kind, at, source_id=''):
    return {'id': f'ev-{kind}-{at}', 'properties': {
        'Kind': {'type': 'select', 'select': {'name': kind}}, 'At': {'type': 'date', 'date': {'start': at}},
        'Source ID': text(source_id), 'Application': {'type': 'relation', 'relation': [{'id': page_id}]}}}


class FakeTracker:
    database_id = 'apps'

    def __init__(self, apps, events=()):
        self.apps, self.events, self.created, self.updates = apps, list(events), [], []

    def query_database(self, database_id, filter_=None):
        if database_id == ledger.EVENTS_DATABASE_ID:
            return self.events
        if database_id == 'interviews' or 'Interviews' in str(database_id):
            return []
        return self.apps if database_id == 'apps' else []

    def create_page(self, database_id, properties):
        self.created.append(properties)
        return {'id': f'new-{len(self.created)}'}

    def update_page(self, page_id, properties):
        self.updates.append((page_id, properties))


class FakeGoogle:
    def __init__(self, emails=(), events=()):
        self.emails, self.cal, self.queries = {e['id']: e for e in emails}, list(events), []

    def search(self, query, limit=50):
        self.queries.append(query)
        return list(self.emails)

    def message(self, message_id):
        return self.emails[message_id]

    def events(self, start, end):
        return self.cal


class FakeClient:
    def __init__(self, results):
        self.results, self.calls, self.messages = results, [], self

    def create(self, **params):
        self.calls.append(params)
        answer = {'results': self.results.pop(0)}
        return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps(answer))],
                               usage=SimpleNamespace(input_tokens=3000, output_tokens=300, cache_read_input_tokens=0,
                                                     cache_creation_input_tokens=0))


def email(message_id, subject, date='2026-09-26T09:00:00+02:00', sender='no-reply@us.greenhouse-mail.io'):
    return {'id': message_id, 'from': sender, 'to': 'me', 'subject': subject, 'date': date, 'body': 'Hello Sam ...'}


def result(index, application, kind, summary='s', relevant=True, interview_at='', company='Acme'):
    return {'index': index, 'relevant': relevant, 'application': application, 'company': company, 'kind': kind,
            'interview_at': interview_at, 'summary': summary}


class MailTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.state = Path(self.tmp.name) / 'state.json'

    def tearDown(self):
        self.tmp.cleanup()

    def run_mail(self, tracker, google, results, calendar=False):
        sent = []
        with mock.patch('src.ai.interviews.stats_for_insights', lambda t: {'topics_answered_weakly': {'Postgres': 2}}):
            summary = mail.run(tracker, google, client=FakeClient(results), days=2, send=sent.append, calendar=calendar,
                               now=NOW, state_path=self.state, stats={})
        return summary, sent

    def test_query_covers_senders_subjects_and_tracked_companies(self):
        q = mail.query([app('a', 'Laelaps AI', 'Infra', via='TechTree')], 2)
        self.assertTrue(q.startswith('newer_than:2d -in:chats'))
        for part in ('from:greenhouse-mail.io', 'from:techtree.dev', 'subject:"interview"', '"Laelaps AI"', '"TechTree"'):
            self.assertIn(part, q)

    def test_rejection_moves_stage_and_is_never_logged_twice(self):
        apps = [app('p1', 'Scale AI', 'Infrastructure Software Engineer')]
        tracker, google = FakeTracker(apps), FakeGoogle([email('m1', 'Update on your application')])
        summary, sent = self.run_mail(tracker, google, [[result(0, 0, 'Rejected', 'Not moving forward')]])
        event = tracker.created[0]
        self.assertEqual((event['Kind']['select']['name'], event['Source']['select']['name']), ('Rejected', 'Gmail'))
        self.assertEqual(event['At']['date']['start'], '2026-09-26T09:00:00+02:00')  # the email's own time
        self.assertIn(('p1', {'Stage': {'select': {'name': 'Rejected'}}}), tracker.updates)
        self.assertIn('❌ Scale AI', sent[0])
        # Next run: the email is in the state file, so it isn't fetched or classified again.
        summary, sent = self.run_mail(tracker, google, [])
        self.assertIn('0 new email(s)', summary)

    def test_the_desktop_app_gets_one_short_line_per_update(self):
        apps = [app('p1', 'Grafana Labs', 'Staff Software Engineer - Databases SRE | Sweden | Remote')]
        tracker, google = FakeTracker(apps), FakeGoogle([email('m1', 'Your application for Grafana Labs')])
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.run_mail(tracker, google, [[result(0, 0, 'Rejected', 'Rejected for Staff Software Engineer position')]])
        self.assertEqual(out.getvalue().splitlines(),
                         ['Updates:', '❌ Rejected · Grafana Labs — Staff Software Engineer - Databases SRE | Sweden'])

    def test_hand_logged_twin_is_linked_not_duplicated(self):
        apps = [app('p1', 'Canonical', 'Site Reliability / Gitops Engineer')]
        tracker = FakeTracker(apps, [event_row('p1', 'Confirmation received', '2026-09-26T01:26:00+02:00')])
        google = FakeGoogle([email('m2', 'Thank you for applying to Canonical', '2026-09-26T01:26:30+02:00')])
        self.run_mail(tracker, google, [[result(0, 0, 'Confirmation received')]])
        self.assertEqual(tracker.created, [])
        self.assertEqual(tracker.updates, [('ev-Confirmation received-2026-09-26T01:26:00+02:00',
                                            {'Source ID': {'rich_text': [{'text': {'content': 'm2'}}]},
                                             'At': {'date': {'start': '2026-09-26T01:26:30+02:00'}}})])

    def test_interview_invite_sets_next_interview_and_stage_forward_only(self):
        apps = [app('p1', 'Laelaps AI', 'Infrastructure Engineer', stage='Confirmation received', via='TechTree'),
                app('p2', 'Acme', 'SRE', stage='Offer')]
        google = FakeGoogle([email('m3', 'Your event has been scheduled', sender='hello@cal.com'),
                             email('m4', 'Next steps', sender='x@acme.test')])
        tracker = FakeTracker(apps)
        self.run_mail(tracker, google, [[result(0, 0, 'Interview scheduled', interview_at='2026-09-30T12:30:00+02:00'),
                                         result(1, 1, 'Interview scheduled')]])
        changes = dict(tracker.updates)
        self.assertEqual(changes['p1']['Stage'], {'select': {'name': 'Interview scheduled'}})
        self.assertEqual(changes['p1']['Next interview'], {'date': {'start': '2026-09-30T12:30:00+02:00'}})
        self.assertNotIn('p2', changes)  # an Offer is never moved back

    def test_emails_are_processed_oldest_first_and_transcripts_are_flagged(self):
        apps = [app('p1', 'Laelaps AI', 'Infrastructure Engineer', via='TechTree')]
        google = FakeGoogle([email('late', 'Reminder: Screening Call', '2026-09-25T09:30:00+00:00'),
                             email('early', 'Screening Call booked', '2026-09-24T18:05:00+00:00'),
                             email('tr', 'Download transcript: Screening Call', '2026-09-25T11:07:00+00:00')])
        tracker = FakeTracker(apps)
        client = FakeClient([[result(0, 0, 'Interview scheduled'), result(1, 0, 'Other'), result(2, 0, 'Other')]])
        with mock.patch('src.ai.interviews.stats_for_insights', lambda t: {'topics_answered_weakly': {}}):
            sent = []
            mail.run(tracker, google, client=client, days=2, send=sent.append, calendar=False, now=NOW,
                     state_path=self.state, stats={})
        self.assertIn('Item 0\nFrom: no-reply@us.greenhouse-mail.io\nDate: 2026-09-24T18:05', client.calls[0]['messages'][0]['content'])
        self.assertEqual(tracker.created[0]['At']['date']['start'], '2026-09-24T18:05:00+00:00')
        self.assertIn('send it to me for an interview review', sent[0])

    def test_unmatched_mail_naming_a_contact_goes_to_that_application(self):
        apps = [app('p1', 'Laelaps AI', 'Infrastructure Engineer', via='TechTree',
                    contact='Jan Keller (TechTree); screening call with Alex Morgan · alex@yupe.io'),
                app('p2', 'Scale AI', 'SRE')]
        google = FakeGoogle([email('n1', 'Notification: Screening Call between Alex Morgan and Sam Taylor',
                                   sender='hello@cal.com')])
        tracker = FakeTracker(apps)
        _, sent = self.run_mail(tracker, google, [[result(0, -1, 'Interview scheduled', company='Unknown')]])
        self.assertEqual(tracker.created[0]['Application'], {'relation': [{'id': 'p1'}]})
        self.assertNotIn('not tracked', ' '.join(sent))
        self.assertIn('Laelaps AI', sent[0])

    def test_unmatched_mail_about_a_contact_domain_is_not_reported_as_new(self):
        apps = [app('p1', 'Laelaps AI', 'Infrastructure Engineer', via='TechTree', contact='alex@yupe.io')]
        google = FakeGoogle([email('n2', 'Your call', sender='hello@cal.com')])
        tracker = FakeTracker(apps)
        _, sent = self.run_mail(tracker, google, [[result(0, -1, 'Interview scheduled', company='YuPe (via Cal.com)')]])
        self.assertEqual((sent, tracker.created), ([], []))

    def test_rejection_naming_no_role_at_a_tracked_company_asks_the_owner(self):
        apps = [app('p1', 'Grafana Labs', 'Staff SRE | Sweden'), app('p2', 'Grafana Labs', 'Staff SRE | Germany')]
        tracker, google = FakeTracker(apps), FakeGoogle([email('g1', 'Your application for Grafana Labs')])
        stats = {}
        with mock.patch('src.ai.interviews.stats_for_insights', lambda t: {'topics_answered_weakly': {}}):
            sent = []
            mail.run(tracker, google, client=FakeClient([[result(0, -1, 'Rejected', company='Grafana Labs')]]), days=2,
                     send=sent.append, calendar=False, now=NOW, state_path=self.state, stats=stats)
        self.assertEqual(tracker.created, [])
        self.assertIn("doesn't say which role", sent[0])
        self.assertIn('Rejected · Grafana Labs', stats['updates'][0])

    def test_emails_read_against_another_ledger_are_read_again(self):
        self.state.write_text(json.dumps({'ledger': 'old-workspace-events', 'seen': ['m1'], 'notified': ['prep:e1']}))
        state = mail.load_state(self.state, ledger='real-events')
        self.assertEqual((state['seen'], state['notified']), ([], ['prep:e1']))
        self.state.write_text(json.dumps({'seen': ['m1'], 'notified': []}))  # written before the ledger was kept
        self.assertEqual(mail.load_state(self.state, ledger='real-events')['seen'], [])
        mail.save_state({'ledger': 'real-events', 'seen': ['m2'], 'notified': []}, self.state)
        self.assertEqual(mail.load_state(self.state, ledger='real-events')['seen'], ['m2'])

    def test_irrelevant_and_untracked_mail(self):
        tracker = FakeTracker([app('p1', 'Scale AI', 'SRE')])
        google = FakeGoogle([email('m5', 'Jobs you may like'), email('m6', 'Thanks for applying to Zeta')])
        _, sent = self.run_mail(tracker, google, [[result(0, -1, 'Other', relevant=False),
                                                   result(1, -1, 'Confirmation received', company='Zeta', summary='Applied')]])
        self.assertEqual(tracker.created, [])
        self.assertIn('Zeta', sent[0])
        self.assertIn('not tracked yet', sent[0])

    def test_calendar_match_by_contact_email_sets_interview_and_sends_prep_once(self):
        start = NOW + timedelta(hours=20)  # tomorrow 14:00 in Zurich
        event = {'id': 'e1', 'status': 'confirmed', 'summary': 'Screening Call between Alex Morgan and Sam Taylor',
                 'created': '2026-09-26T10:00:00Z', 'hangoutLink': 'https://meet.test/x',
                 'start': {'dateTime': start.isoformat()}, 'end': {'dateTime': (start + timedelta(minutes=30)).isoformat()},
                 'attendees': [{'email': 'alex@yupe.io', 'displayName': 'Alex Morgan'}, {'email': 'me@x', 'self': True}]}
        apps = [app('p1', 'Laelaps AI', 'Infrastructure Engineer', stage='Screening', via='TechTree',
                    contact='Jan (TechTree) · jan@techtree.dev; Alex Morgan · alex@yupe.io')]
        tracker, google = FakeTracker(apps), FakeGoogle(events=[event])
        _, sent = self.run_mail(tracker, google, [], calendar=True)
        created = tracker.created[0]
        self.assertEqual((created['Kind']['select']['name'], created['Source']['select']['name']), ('Interview scheduled', 'Calendar'))
        self.assertEqual(dict(tracker.updates)['p1']['Next interview'], {'date': {'start': start.isoformat()}})
        prep = [m for m in sent if m.startswith('🗓 <b>Tomorrow')]
        self.assertEqual(len(prep), 1)
        self.assertIn('Postgres', prep[0])
        self.assertIn('With: Alex Morgan', prep[0])
        _, sent = self.run_mail(tracker, google, [], calendar=True)
        self.assertFalse([m for m in sent if m.startswith('🗓 <b>Tomorrow')])  # once only

    def test_after_the_interview_asks_for_the_transcript(self):
        start = NOW - timedelta(hours=3)
        event = {'id': 'e2', 'summary': 'Laelaps AI technical interview', 'start': {'dateTime': start.isoformat()},
                 'end': {'dateTime': (start + timedelta(hours=1)).isoformat()}}
        tracker = FakeTracker([app('p1', 'Laelaps AI', 'Infrastructure Engineer')])
        _, sent = self.run_mail(tracker, FakeGoogle(events=[event]), [], calendar=True)
        self.assertTrue(any('How did' in m and 'transcript' in m for m in sent))


class LimitTests(unittest.TestCase):
    def test_limit_reached(self):
        from src.ai import cost
        self.assertTrue(cost.limit_reached(Exception("You have reached your specified API usage limits.")))
        self.assertTrue(cost.limit_reached(Exception('Your credit balance is too low')))
        self.assertFalse(cost.limit_reached(Exception('overloaded')))


class GoogleApiTests(unittest.TestCase):
    def test_expired_sign_in_is_reported_clearly(self):
        import io, urllib.error
        def opener(request, timeout=None):
            raise urllib.error.HTTPError(google_api.TOKEN_URL, 400, 'Bad Request', {},
                                         io.BytesIO(b'{"error": "invalid_grant", "error_description": "Token has been expired or revoked."}'))
        client = google_api.Google('id', 'secret', 'refresh', opener=opener)
        with self.assertRaises(RuntimeError) as caught:
            client.profile()
        self.assertIn('invalid_grant', str(caught.exception))

    def test_auth_without_a_client_uses_the_shared_published_app(self):
        shared = {'client_id': 'shared-id.apps.googleusercontent.com', 'client_secret': 'shared-secret'}
        with tempfile.TemporaryDirectory() as tmp:
            client_file = Path(tmp) / 'google_oauth_client.json'
            client_file.write_text(json.dumps({'installed': shared}))
            with mock.patch.object(google_api, 'SHARED_CLIENT', client_file), \
                    mock.patch.object(google_api, 'authorize', return_value='refresh') as authorize, \
                    mock.patch.object(google_api, 'store') as store, mock.patch.object(google_api, 'report'):
                google_api.main(['auth', '--github'])
        authorize.assert_called_once_with(shared['client_id'], shared['client_secret'])
        store.assert_called_once_with(shared['client_id'], shared['client_secret'], 'refresh', True, True)  # published

    def test_auth_without_the_bundled_shared_client_points_to_setup(self):
        with mock.patch.object(google_api, 'SHARED_CLIENT', Path('/nonexistent/google_oauth_client.json')), \
                mock.patch('sys.stderr', io.StringIO()) as stderr, self.assertRaises(SystemExit):
            google_api.main(['auth'])
        self.assertIn('setup', stderr.getvalue())

    def test_guided_setup_finds_the_newly_downloaded_client_file(self):
        from src.sources import google_setup
        import os, time
        with tempfile.TemporaryDirectory() as tmp:
            old_file = Path(tmp) / 'client_secret_old.json'
            old_file.write_text('{}')
            os.utime(old_file, (time.time() - 3600, time.time() - 3600))
            start = time.time() - 1
            self.assertIsNone(google_setup.newest_client_file(start, tmp))
            new_file = Path(tmp) / 'client_secret_new.json'
            new_file.write_text('{}')
            self.assertEqual(google_setup.newest_client_file(start, tmp), str(new_file))

    def test_auth_reads_the_downloaded_client_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'client_secret.json'
            path.write_text(json.dumps({'installed': {'client_id': 'cid', 'client_secret': 'sec'}}))
            with mock.patch.object(google_api, 'authorize', side_effect=SystemExit('stop')) as authorize:
                with self.assertRaises(SystemExit):
                    google_api.main(['auth', '--client-json', str(path)])
            authorize.assert_called_once_with('cid', 'sec')

    def test_body_text_prefers_plain_and_strips_html(self):
        enc = lambda s: base64.urlsafe_b64encode(s.encode()).decode().rstrip('=')
        html_only = {'mimeType': 'multipart/alternative', 'parts': [
            {'mimeType': 'text/html', 'body': {'data': enc('<p>Thank you&nbsp;for <b>applying</b></p><style>x{}</style>')}}]}
        self.assertEqual(google_api.body_text(html_only), 'Thank you for applying')
        both = {'mimeType': 'multipart/alternative', 'parts': [
            {'mimeType': 'text/plain', 'body': {'data': enc('Plain wins')}},
            {'mimeType': 'text/html', 'body': {'data': enc('<p>HTML</p>')}}]}
        self.assertEqual(google_api.body_text(both), 'Plain wins')


if __name__ == '__main__':
    unittest.main()
