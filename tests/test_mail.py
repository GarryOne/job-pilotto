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
from tests import zone

setUpModule, tearDownModule = zone.pinned()

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


def email(message_id, subject, date='2026-09-26T09:00:00+02:00', sender='no-reply@us.greenhouse-mail.io', body='Hello Sam ...'):
    return {'id': message_id, 'from': sender, 'to': 'me', 'subject': subject, 'date': date, 'body': body}


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
        q = mail.query([app('a', 'Zephyr AI', 'Infra', via='TechTree')], 2)
        self.assertTrue(q.startswith('newer_than:2d -in:chats'))
        for part in ('from:greenhouse-mail.io', 'from:techtree.dev', 'subject:"interview"', '"Zephyr AI"', '"TechTree"'):
            self.assertIn(part, q)

    def test_rejection_moves_stage_and_is_never_logged_twice(self):
        apps = [app('p1', 'Scale AI', 'Infrastructure Software Engineer')]
        tracker, google = FakeTracker(apps), FakeGoogle([email('m1', 'Update on your application', body='Thank you for your interest in Scale AI ...')])
        summary, sent = self.run_mail(tracker, google, [[result(0, 0, 'Rejected', 'Not moving forward')]])
        event = tracker.created[0]
        self.assertEqual((event['Kind']['select']['name'], event['Source']['select']['name']), ('Rejected', 'Gmail'))
        self.assertEqual(event['At']['date']['start'], '2026-09-26T09:00:00+02:00')  # the email's own time
        self.assertIn(('p1', {'Stage': {'select': {'name': 'Rejected'}}}), tracker.updates)
        self.assertIn('❌ Scale AI', sent[0])
        # Next run: the email is in the state file, so it isn't fetched or classified again.
        summary, sent = self.run_mail(tracker, google, [])
        self.assertIn('0 new email(s)', summary)

    def test_a_recruiter_writing_back_after_you_answered_moves_the_lead_to_screening(self):
        apps = [app('p1', '', 'Senior DevOps Engineer', stage='Recruiter lead', via='AG Talent')]
        google = FakeGoogle([email('m1', 'Re: DevOps Engineer - Fully Remote', sender='agillard@agtalent.co.uk')])
        tracker = FakeTracker(apps, [event_row('p1', 'Replied', '2026-09-26T00:23:00+00:00')])
        self.run_mail(tracker, google, [[result(0, 0, ledger.REPLY, 'Sent a booking link')]])
        self.assertIn(('p1', {'Stage': {'select': {'name': 'Screening'}}}), tracker.updates)
        # Without your answer first, a second message from the recruiter leaves it a lead.
        apps = [app('p2', '', 'SRE', stage='Recruiter lead', via='AG Talent')]
        tracker = FakeTracker(apps)
        self.state.unlink(missing_ok=True)
        self.run_mail(tracker, FakeGoogle([email('m2', 'Following up', sender='agillard@agtalent.co.uk')]), [[result(0, 0, ledger.REPLY)]])
        self.assertFalse([u for u in tracker.updates if 'Stage' in u[1]])

    def test_a_check_someone_started_always_answers(self):  # the flag is still there for GitHub's Run button
        tracker, google = FakeTracker([app('p1', 'Acme', 'SRE')]), FakeGoogle([email('m1', 'Newsletter')])
        sent = []
        with mock.patch('src.ai.interviews.stats_for_insights', lambda t: {}):
            mail.run(tracker, google, client=FakeClient([[result(0, 0, 'Other', relevant=False)]]), days=2, send=sent.append,
                     calendar=False, now=NOW, state_path=self.state, stats={}, always_report=True)
        self.assertEqual(sent, ['📧 Gmail checked: 1 new email(s), nothing that changes your applications.'])

    def test_a_quiet_check_without_that_flag_says_nothing(self):
        # The mail workflow no longer sets it (the app dispatches it for "Check Gmail now"): a check that recorded
        # nothing stays quiet on Telegram, and the app shows it in Recent activity.
        tracker, google = FakeTracker([app('p1', 'Acme', 'SRE')]), FakeGoogle([email('m1', 'Newsletter')])
        sent = []
        with mock.patch('src.ai.interviews.stats_for_insights', lambda t: {}):
            mail.run(tracker, google, client=FakeClient([[result(0, 0, 'Other', relevant=False)]]), days=2, send=sent.append,
                     calendar=False, now=NOW, state_path=self.state, stats={})
        self.assertEqual(sent, [])

    def test_the_desktop_app_gets_one_short_line_per_update(self):
        # The line names what the email changed, not only what was recorded: a check's "1 update(s) recorded" is
        # otherwise a number with no way to see what moved in the ledger (1 Oct 2026).
        apps = [app('p1', 'Grafana Labs', 'Staff Software Engineer - Databases SRE | Sweden | Remote')]
        tracker, google = FakeTracker(apps), FakeGoogle([email('m1', 'Your application for Grafana Labs')])
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.run_mail(tracker, google, [[result(0, 0, 'Rejected', 'Rejected for Staff Software Engineer position')]])
        self.assertEqual(out.getvalue().splitlines(),
                         ['Updates:', '❌ Rejected · Grafana Labs — Staff Software Engineer - Databases SRE | Sweden'
                                      ' · Stage Applied → Rejected'])

    def test_the_run_keeps_one_record_per_email_with_its_link_and_what_it_did(self):
        # For the run's Notion page: the subject, a link that opens the email again, and the side effect in words.
        apps = [app('p1', 'Canonical', 'Site Reliability Engineer')]
        tracker = FakeTracker(apps)
        google = FakeGoogle([email('m1', 'Thank you for applying to Canonical', body='Thank you for applying to the '
                                        'Site Reliability Engineer position at Canonical.'),
                             email('m2', 'A newsletter', sender='news@example.test')])
        stats = {}
        client = FakeClient([[result(0, 0, 'Confirmation received', company='Canonical'),
                              result(1, -1, 'Other', relevant=False)]])
        with mock.patch('src.ai.interviews.stats_for_insights', lambda t: {}):
            mail.run(tracker, google, client=client, days=2, send=None, calendar=False, now=NOW, state_path=self.state,
                     stats=stats)
        [read] = stats['emails']  # the newsletter is not about the applications: read, marked seen, never listed
        self.assertEqual(read['action'], 'recorded')
        self.assertEqual(read['link'], 'https://mail.google.com/mail/u/0/#all/m1')
        self.assertEqual(read['subject'], 'Thank you for applying to Canonical')
        self.assertEqual(read['changes'], 'Stage Applied → Confirmation received; Confirmation email set')
        self.assertEqual(stats['updates'],
                         ['📬 Application received · Canonical — Site Reliability Engineer'
                          ' · Stage Applied → Confirmation received; Confirmation email set'])

    def test_hand_logged_twin_is_linked_not_duplicated(self):
        apps = [app('p1', 'Canonical', 'Site Reliability / Gitops Engineer')]
        tracker = FakeTracker(apps, [event_row('p1', 'Confirmation received', '2026-09-26T01:26:00+02:00')])
        google = FakeGoogle([email('m2', 'Thank you for applying to Canonical', '2026-09-26T01:26:30+02:00')])
        self.run_mail(tracker, google, [[result(0, 0, 'Confirmation received')]])
        self.assertEqual(tracker.created, [])
        page = 'ev-Confirmation received-2026-09-26T01:26:00+02:00'
        update = {k: v for p, u in tracker.updates if p == page for k, v in u.items()}
        self.assertEqual((update['Source ID'], update['At']), ({'rich_text': [{'text': {'content': 'm2'}}]},
                                                               {'date': {'start': '2026-09-26T01:26:30+02:00'}}))
        changes = json.loads(update['Changes']['rich_text'][0]['text']['content'])
        self.assertEqual(changes['fields']['Stage'], ['Applied', 'Confirmation received'])  # what the email changed
        self.assertEqual(apps[0]['properties']['Stage']['select']['name'], 'Confirmation received')  # repair a partially saved event

    def test_a_confirmation_for_a_role_still_at_kit_ready_is_recorded(self):
        # 1 Oct 2026: Canonical's "Thank you for applying" named the role "Site Reliability Engineer", which the
        # tracker held at Stage Kit ready (a kit drafted, never marked Applied). applications() listed only outcome
        # stages, so the reader couldn't see that row: it reached for the rejected "Site Reliability / Gitops
        # Engineer", whose one Confirmation event the ledger's one-per-kind rule reused — no event, no move, and
        # "0 updates" for an email that was really a confirmation.
        kit = app('p1', 'Canonical', 'Site Reliability Engineer', stage='Kit ready')

        class Tracker(FakeTracker):
            def query_database(self, database_id, filter_=None):
                if database_id == ledger.EVENTS_DATABASE_ID:
                    return self.events
                stages = [choice['select']['equals'] for choice in (filter_ or {}).get('or', [])]
                return [row for row in self.apps if not stages or row['properties']['Stage']['select']['name'] in stages]

        tracker = Tracker([kit])
        google = FakeGoogle([email('m1', 'Thank you for applying to Canonical', '2026-10-01T02:56:00+02:00',
                                   body='Dear Igor\n\nThank you for applying to the Site Reliability Engineer '
                                        'position at Canonical.')])
        # The reader answers with that row's index (the replay of 1 Oct 2026: application 27 = this row), and the
        # row stays the one the email names, so the event is recorded on it rather than on a twin.
        with mock.patch.object(mail, 'classify', lambda *a, **k: {0: {
                **result(0, 0, 'Confirmation received', company='Canonical'), 'role': 'Site Reliability Engineer'}}), \
                mock.patch('src.ai.interviews.stats_for_insights', lambda t: {}):
            summary = mail.run(tracker, google, client=SimpleNamespace(), days=2, send=[].append, calendar=False, now=NOW,
                               state_path=self.state, stats={})
        self.assertIn('1 new email(s) classified, 1 update(s)', summary)
        self.assertEqual(kit['properties']['Stage']['select']['name'], 'Confirmation received')
        self.assertTrue(kit['properties']['Confirmation email']['checkbox'])
        kinds = [p['Kind']['select']['name'] for p in tracker.created]
        self.assertEqual(kinds, ['Confirmation received'])  # its own event, not swallowed as a repeat

    def test_the_reader_sees_roles_still_at_kit_ready_or_applying(self):
        # Read unfiltered and filtered here: a Notion filter on a Stage choice the workspace lacks is a 400 that
        # fails the whole check (1 Oct 2026, the "Saved" choice), and the reader may not look for "Recruiter lead".
        tracker, filters = FakeTracker([
            app('p1', 'Canonical', 'Site Reliability Engineer', stage='Kit ready'),
            app('p2', 'Acme', 'SRE', stage='Applying'),
            app('p3', 'Beta', 'Data Engineer', stage='Dismissed')]), []
        tracker.query_database = lambda db, f=None: filters.append(f) or tracker.apps + [app('x', 'Gamma', 'Saved role', stage='Saved')]
        self.assertEqual([r['id'] for r in mail.applications(tracker)], ['p1', 'p2', 'x'])
        self.assertEqual(filters, [None])  # never a filter Notion could refuse

    def test_interview_invite_sets_next_interview_and_stage_forward_only(self):
        apps = [app('p1', 'Zephyr AI', 'Infrastructure Engineer', stage='Confirmation received', via='TechTree'),
                app('p2', 'Acme', 'SRE', stage='Offer')]
        google = FakeGoogle([email('m3', 'Your event has been scheduled', sender='hello@cal.com', body='Zephyr AI screening call ...'),
                             email('m4', 'Next steps', sender='x@acme.test')])
        tracker = FakeTracker(apps)
        self.run_mail(tracker, google, [[result(0, 0, 'Interview scheduled', interview_at='2026-09-30T12:30:00+02:00'),
                                         result(1, 1, 'Interview scheduled')]])
        changes = dict(tracker.updates)
        self.assertEqual(changes['p1']['Stage'], {'select': {'name': 'Interview scheduled'}})
        self.assertEqual(changes['p1']['Next interview'], {'date': {'start': '2026-09-30T12:30:00+02:00'}})
        self.assertNotIn('p2', changes)  # an Offer is never moved back

    def test_emails_are_processed_oldest_first_and_transcripts_are_flagged(self):
        apps = [app('p1', 'Zephyr AI', 'Infrastructure Engineer', via='TechTree')]
        zephyr = 'Your screening call with Zephyr AI ...'
        google = FakeGoogle([email('late', 'Reminder: Screening Call', '2026-09-25T09:30:00+00:00', body=zephyr),
                             email('early', 'Screening Call booked', '2026-09-24T18:05:00+00:00', body=zephyr),
                             email('tr', 'Download transcript: Screening Call', '2026-09-25T11:07:00+00:00', body=zephyr)])
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
        apps = [app('p1', 'Zephyr AI', 'Infrastructure Engineer', via='TechTree',
                    contact='Jan Keller (TechTree); screening call with Alex Morgan · alex@yupe.io'),
                app('p2', 'Scale AI', 'SRE')]
        google = FakeGoogle([email('n1', 'Notification: Screening Call between Alex Morgan and Sam Taylor',
                                   sender='hello@cal.com')])
        tracker = FakeTracker(apps)
        _, sent = self.run_mail(tracker, google, [[result(0, -1, 'Interview scheduled', company='Unknown')]])
        self.assertEqual(tracker.created[0]['Application'], {'relation': [{'id': 'p1'}]})
        self.assertNotIn('not tracked', ' '.join(sent))
        self.assertIn('Zephyr AI', sent[0])

    def test_unmatched_mail_about_a_contact_domain_is_not_reported_as_new(self):
        apps = [app('p1', 'Zephyr AI', 'Infrastructure Engineer', via='TechTree', contact='alex@yupe.io')]
        google = FakeGoogle([email('n2', 'Your call', sender='hello@cal.com')])
        tracker = FakeTracker(apps)
        _, sent = self.run_mail(tracker, google, [[result(0, -1, 'Interview scheduled', company='YuPe (via Cal.com)')]])
        [question] = tracker.created  # about a tracked process (a contact's domain) but no job named: asked, that one suggested
        self.assertEqual(question['Suggested job'], {'url': 'https://x.test/p1'})
        self.assertFalse([u for u in tracker.updates if 'Stage' in u[1]])

    def test_rejection_naming_no_role_at_a_tracked_company_asks_the_owner(self):
        apps = [app('p1', 'Grafana Labs', 'Staff SRE | Sweden'), app('p2', 'Grafana Labs', 'Staff SRE | Germany')]
        tracker, google = FakeTracker(apps), FakeGoogle([email('g1', 'Your application for Grafana Labs')])
        stats = {}
        with mock.patch('src.ai.interviews.stats_for_insights', lambda t: {'topics_answered_weakly': {}}):
            sent = []
            mail.run(tracker, google, client=FakeClient([[result(0, -1, 'Rejected', company='Grafana Labs')]]), days=2,
                     send=sent.append, calendar=False, now=NOW, state_path=self.state, stats=stats)
        [question] = tracker.created
        self.assertEqual(question['Kind'], {'select': {'name': 'Rejected'}})
        self.assertEqual(question['Suggested job'], {'url': 'https://x.test/p1'})
        self.assertIn('which job', sent[0])
        self.assertIn('Rejected · Grafana Labs', stats['updates'][0])
        self.assertFalse([u for u in tracker.updates if 'Stage' in u[1]])  # no job moved on a guess

    def test_a_role_named_in_email_but_not_tracked_becomes_an_application(self):
        apps = [app('p1', 'Grafana Labs', 'Staff SRE | Sweden | Remote')]
        google = FakeGoogle([email('c1', 'Thank you for applying to Grafana Labs', '2026-09-25T09:00:00+02:00'),
                             email('r1', 'Your application for Grafana Labs', '2026-09-26T07:00:00+02:00')])
        tracker, stats = FakeTracker(apps), {}
        spain = dict(company='Grafana Labs', role='Staff SRE | Spain | Remote')
        with mock.patch('src.ai.interviews.stats_for_insights', lambda t: {'topics_answered_weakly': {}}):
            mail.run(tracker, google, client=FakeClient([[{**result(0, -1, 'Confirmation received'), **spain},
                                                          {**result(1, -1, 'Rejected'), **spain}]]),
                     days=2, send=[].append, calendar=False, now=NOW, state_path=self.state, stats=stats)
        rows = [p for p in tracker.created if 'Stage' in p]
        self.assertEqual(len(rows), 1)  # the rejection found the row the confirmation made
        self.assertEqual(rows[0]['Job']['title'][0]['text']['content'], 'Staff SRE | Spain | Remote')
        self.assertEqual(rows[0]['Applied on']['date']['start'], '2026-09-25')
        kinds = [p['Kind']['select']['name'] for p in tracker.created if 'Kind' in p]
        self.assertEqual(kinds, ['Applied', 'Confirmation received', 'Rejected'])
        self.assertIn({'Stage': {'select': {'name': 'Rejected'}}}, [u for _, u in tracker.updates])
        self.assertIn('➕ Tracked · Grafana Labs — Staff SRE | Spain | Remote', stats['updates'])

    def test_a_role_on_the_list_but_never_marked_applied_becomes_the_application(self):
        kit_ready = app('k1', 'Grafana Labs', 'Staff SRE | Spain | Remote', stage='Kit ready', applied='')

        class Tracker(FakeTracker):
            def query_database(self, database_id, filter_=None):
                if filter_ and filter_.get('property') == 'Company':
                    return [kit_ready]
                return super().query_database(database_id, filter_)
        tracker, stats = Tracker([app('p1', 'Grafana Labs', 'Staff SRE | Sweden | Remote')]), {}
        google = FakeGoogle([email('r1', 'Your application for Grafana Labs', '2026-09-26T07:00:00+02:00')])
        with mock.patch('src.ai.interviews.stats_for_insights', lambda t: {'topics_answered_weakly': {}}), \
                mock.patch('src.ai.mail.review_rejections', lambda *a, **k: []):
            mail.run(tracker, google, client=FakeClient([[{**result(0, -1, 'Rejected'), 'company': 'Grafana Labs',
                                                          'role': 'Staff SRE | Spain | Remote'}]]),
                     days=2, send=[].append, calendar=False, now=NOW, state_path=self.state, stats=stats)
        self.assertEqual([p for p in tracker.created if 'Stage' in p], [])  # no twin
        self.assertEqual(tracker.updates[0], ('k1', {'Stage': {'select': {'name': 'Applied'}}, 'Date approximate': {'checkbox': True},
                                                     'Applied on': {'date': {'start': '2026-09-26'}}}))
        self.assertIn(('k1', {'Stage': {'select': {'name': 'Rejected'}}}), tracker.updates)
        self.assertIn('➕ Marked applied · Grafana Labs — Staff SRE | Spain | Remote', stats['updates'])

    def test_an_email_naming_the_employer_of_a_recruiters_lead_is_the_same_opportunity(self):
        """2 Oct 2026: "AG Talent — Senior DevOps Engineer" (Company hidden, Via AG Talent) and a twin "Blinq — DevOps Engineer"."""
        lead = app('p1', '', 'Senior DevOps Engineer', stage='Screening', via='AG Talent', contact='Sam · sam@agtalent.com')
        tracker = FakeTracker([lead])
        google = FakeGoogle([email('m1', 'Blinq - DevOps Engineer', sender='Sam <sam@agtalent.com>',
                                   body='Hi Igor, AG Talent here. Blinq is hiring a DevOps Engineer, B2B contract.')])
        with mock.patch('src.ai.interviews.stats_for_insights', lambda t: {'topics_answered_weakly': {}}):
            mail.run(tracker, google, client=FakeClient([[{**result(0, -1, 'Reply received', company='Blinq'), 'role': 'DevOps Engineer'}]]),
                     days=2, send=[].append, calendar=False, now=NOW, state_path=self.state, stats={})
        self.assertEqual([p for p in tracker.created if 'Stage' in p], [])  # no twin row
        self.assertIn(('p1', {'Company': {'rich_text': [{'text': {'content': 'Blinq'}}]}}), tracker.updates)  # the lead learns its employer

    def test_an_email_that_only_shares_the_agency_with_a_lead_is_asked_about_not_merged_or_duplicated(self):
        lead = app('p1', '', 'Platform Engineer', stage='Screening', via='AG Talent', contact='Sam · sam@agtalent.com')
        tracker, sent = FakeTracker([lead]), []
        google = FakeGoogle([email('m1', 'Blinq - DevOps Engineer', sender='Pat <pat@other.example>',
                                   body='Hello, this is about AG Talent and a DevOps Engineer role at Blinq.')])
        with mock.patch('src.ai.interviews.stats_for_insights', lambda t: {'topics_answered_weakly': {}}):
            mail.run(tracker, google, client=FakeClient([[{**result(0, -1, 'Reply received', company='Blinq'), 'role': 'DevOps Engineer'}]]),
                     days=2, send=sent.append, calendar=False, now=NOW, state_path=self.state, stats={})
        self.assertEqual([p for p in tracker.created if 'Stage' in p and 'Job' in p], [])  # no new row
        self.assertNotIn('Company', dict(tracker.updates).get('p1', {}))                  # no silent merge
        self.assertTrue(any(p.get('Needs you', {}).get('checkbox') for p in tracker.created))  # asked, in Focus

    def test_a_placeholder_plain_part_falls_back_to_the_html(self):
        encode = lambda text: base64.urlsafe_b64encode(text.encode()).decode()
        payload = {'mimeType': 'multipart/alternative', 'parts': [
            {'mimeType': 'text/plain', 'body': {'data': encode('No Text Available')}},
            {'mimeType': 'text/html', 'body': {'data': encode('<p>We have decided not to move forward.</p>')}}]}
        self.assertEqual(google_api.body_text(payload), 'We have decided not to move forward.')

    def test_emails_read_against_another_ledger_are_read_again(self):
        self.state.write_text(json.dumps({'ledger': 'old-workspace-events', 'seen': ['m1'], 'notified': ['prep:e1']}))
        state = mail.load_state(self.state, ledger='real-events')
        self.assertEqual((state['seen'], state['notified']), ([], ['prep:e1']))
        self.state.write_text(json.dumps({'seen': ['m1'], 'notified': []}))  # written before the ledger was kept
        self.assertEqual(mail.load_state(self.state, ledger='real-events')['seen'], [])
        mail.save_state({'ledger': 'real-events', 'seen': ['m2'], 'notified': []}, self.state)
        self.assertEqual(mail.load_state(self.state, ledger='real-events')['seen'], ['m2'])

    def test_query_also_asks_for_agencies_invitations_and_short_role_names(self):
        with mock.patch.object(mail, 'role_words', lambda: ('site reliability', 'devops engineer')):
            q = mail.query([], 2)
        self.assertIn('subject:"SRE"', q)
        self.assertIn('subject:"DevOps"', q)
        extra = mail.extra_query(2)
        self.assertIn('from:huxley.com', extra)
        self.assertIn('filename:invite.ics', extra)
        self.assertNotIn('huxley', q)  # a second, short search: the first one stays within Gmail's limit

    def test_invitation_mails_are_searched_by_their_google_wrappers_too(self):
        extra = mail.extra_query(2)
        self.assertIn('from:calendar-notification@google.com', extra)
        self.assertIn('subject:"Invitation from an unknown sender"', extra)

    def test_a_booking_from_a_stranger_asks_about_the_one_lead_without_an_employer(self):
        # 2 Oct 2026: a Calendly booking "Igor Mardari and Blockdaemon DM" (a Gmail sender) for a LinkedIn recruiter lead
        # whose employer was never named: it must be a question in Focus naming that lead, not a second job.
        lead = app('p9', '', 'Senior Web3 Infrastructure / DevOps Engineer', stage='Screening', contact='Linomica Irigoyen')
        other = app('p2', 'Acme', 'SRE', stage='Applied')
        tracker = FakeTracker([lead, other])
        invite = {**email('b1', 'Invitation from an unknown sender: Igor Mardari and Blockdaemon DM @ Mon 5 Oct 2026 10:45',
                          sender='Blockdaemon DM <blockdaemonmdw@gmail.com>', body='Google Meet, powered by Calendly'),
                  'invite_at': '2026-10-05T10:45:00+02:00'}
        with mock.patch('src.ai.opportunity.extract', side_effect=RuntimeError('must not create a second job')), \
                mock.patch('src.ai.opportunity.track', side_effect=RuntimeError('must not create a second job')):
            self.run_mail(tracker, FakeGoogle([invite]), [[result(0, -1, 'Interview scheduled', company='Blockdaemon')]])
        self.assertEqual(len(tracker.created), 1)
        self.assertTrue(tracker.created[0]['Needs you']['checkbox'])
        self.assertEqual(tracker.created[0]['Suggested job'], {'url': 'https://x.test/p9'})

    def test_two_leads_without_an_employer_are_not_guessed_between(self):
        a = app('p9', '', 'Web3 DevOps', stage='Screening', contact='Linomica Irigoyen')
        b = app('p8', '', 'Platform lead', stage='Recruiter lead', contact='Sam Lee')
        self.assertEqual(len(mail._unnamed_leads([a, b])), 2)

    def test_an_email_is_never_attached_to_a_job_it_doesnt_name(self):
        # 29 Sep 2026: Huxley's SRE invitation was attached to AG Talent's DevOps pitch (the AI matched the role).
        ag = app('p1', '', 'Senior DevOps Engineer', stage='Screening', via='AG Talent', contact='Arjun Gillard · agillard@agtalent.co.uk')
        tracker = FakeTracker([ag])
        invite = email('h1', 'Connect Igor / Jaya - SRE', sender='Jaya <j.nejati@huxley.com>', body='Microsoft Teams meeting')
        with mock.patch('src.ai.opportunity.extract', side_effect=RuntimeError('no AI in tests')), \
                mock.patch('src.ai.opportunity.track', lambda *a, **k: (app('new', '', 'SRE', stage='Screening', via='Huxley'), '')):
            self.run_mail(tracker, FakeGoogle([invite]), [[result(0, 0, 'Interview scheduled', company='Huxley')]])
        self.assertNotIn('p1', [page for page, _ in tracker.updates])
        self.assertTrue(mail._names_it(ag, email('r', 'Re: DevOps Engineer', sender='agillard@agtalent.co.uk')))
        self.assertTrue(mail._names_it(ag, email('r', 'Hi', sender='x@other.io', body='Arjun Gillard, AG Talent')))

    def test_one_recruiter_by_email_and_on_linkedin_is_one_job_at_the_invitations_time(self):
        # 29 Sep 2026: Huxley's Teams invite and Jayantie's LinkedIn InMail about the same call made two jobs, and the
        # invite's time was the email's (the text had no date; the .ics had it).
        tracker = FakeTracker([])
        invite = {**email('h1', 'Connect Igor / Jaya - SRE', '2026-09-29T14:35:00+02:00',
                          sender='"Seosahai - Nejati, Jayantie" <j.nejati@huxley.com>', body='Microsoft Teams meeting'),
                  'invite_at': '2026-09-30T10:30:00+04:00'}
        inmail = email('l1', 'Message replied: Principal SRE - Remote opportunity for a global AI company',
                       '2026-09-29T14:40:00+02:00', sender='LinkedIn <inmail-hit-reply@linkedin.com>',
                       body='Jayantie Nejati: I have shared a calendar invite to speak tomorrow morning 08:30am CET')
        made = []

        def track(tracker_, lead, text_, **options):
            made.append(lead)
            row = app(f'new{len(made)}', '', lead['title'], stage='Screening', via=lead.get('recruiter_company', ''),
                      contact=' · '.join(p for p in (lead.get('recruiter_name'), lead.get('recruiter_email')) if p))
            return row, ''
        with mock.patch('src.ai.opportunity.extract', side_effect=RuntimeError('no AI in tests')), \
                mock.patch('src.ai.opportunity.track', track):
            self.run_mail(tracker, FakeGoogle([invite, inmail]), [[
                result(0, -1, 'Interview scheduled', company='Huxley', interview_at='2026-09-29T14:35:00+02:00'),
                result(1, -1, 'Interview scheduled', company='LinkedIn', interview_at='2026-09-30T08:30:00+01:00')]])
        self.assertEqual(len(made), 1)  # one job: the InMail names the invite's sender
        self.assertEqual((made[0]['recruiter_company'], made[0]['recruiter_name']), ('Huxley', 'Jayantie Nejati'))
        dates = [u['Next interview']['date']['start'] for _, u in tracker.updates if 'Next interview' in u]
        self.assertEqual(dates, ['2026-09-30T10:30:00+04:00'])  # the invitation's time (08:30 in Zurich), kept

    def test_a_platform_is_never_the_agency(self):
        self.assertEqual(mail._sender_org('LinkedIn <inmail-hit-reply@linkedin.com>'), '')
        self.assertEqual(mail._sender_org('Jaya <j.nejati@huxley.com>'), 'Huxley')
        self.assertEqual(mail.person_name('Seosahai - Nejati, Jayantie'), 'Jayantie Nejati')

    def test_one_agency_two_of_your_roles_and_the_email_names_neither_is_asked(self):
        apps = [app('p1', '', 'Senior DevOps Engineer', stage='Screening', via='AG Talent'),
                app('p2', '', 'Platform Engineer (Kubernetes)', stage='Screening', via='AG Talent')]
        tracker = FakeTracker(apps)
        vague = email('a1', 'Quick call tomorrow?', sender='agillard@agtalent.co.uk', body='Hi Igor, are you free for a quick chat? AG Talent')
        _, sent = self.run_mail(tracker, FakeGoogle([vague]), [[result(0, 1, ledger.REPLY, company='AG Talent')]])
        [question] = tracker.created
        self.assertEqual(question['Suggested job'], {'url': 'https://x.test/p2'})  # the AI's pick, offered, not applied
        self.assertFalse([u for u in tracker.updates if 'Stage' in u[1]])
        clear = email('a2', 'Platform Engineer role: next steps', sender='agillard@agtalent.co.uk', body='About the Kubernetes platform role')
        tracker = FakeTracker(apps)
        self.state.unlink(missing_ok=True)
        self.run_mail(tracker, FakeGoogle([clear]), [[result(0, 1, 'Interview scheduled', company='AG Talent')]])
        self.assertIn('p2', [page for page, _ in tracker.updates])  # it names the role: applied

    def test_an_interview_about_a_job_not_tracked_is_tracked_and_asks_which_job(self):
        tracker = FakeTracker([app('p1', 'Scale AI', 'SRE')])
        invite = email('h1', 'Connect Igor / Jaya - SRE', sender='Jaya <j.nejati@huxley.com>')
        google = FakeGoogle([invite])
        tracked = []

        def track(tracker_, lead, text_, **options):
            tracked.append(lead)
            row = app('new-lead', '', lead['title'], stage='Screening', via=lead.get('recruiter_company', ''))
            return row, ''
        with mock.patch('src.ai.opportunity.extract', side_effect=RuntimeError('no AI in tests')), \
                mock.patch('src.ai.opportunity.track', track):
            _, sent = self.run_mail(tracker, google, [[result(0, -1, 'Interview scheduled', company='Huxley',
                                                              interview_at='2026-09-30T08:30:00+02:00')]])
        self.assertEqual(tracked[0]['recruiter_company'], 'Huxley')
        self.assertEqual(tracked[0]['company'], '')  # the agency is not the employer
        self.assertEqual(tracked[0]['title'], 'Connect Igor / Jaya - SRE')
        kinds = [p['Kind']['select']['name'] for p in tracker.created if 'Kind' in p]
        self.assertIn('Interview scheduled', kinds)
        self.assertIn('which job?', sent[0])

    def test_irrelevant_and_untracked_mail(self):
        tracker = FakeTracker([app('p1', 'Scale AI', 'SRE')])
        google = FakeGoogle([email('m5', 'Jobs you may like'), email('m6', 'Thanks for applying to Zeta')])
        _, sent = self.run_mail(tracker, google, [[result(0, -1, 'Other', relevant=False),
                                                   result(1, -1, 'Confirmation received', company='Zeta', summary='Applied')]])
        [question] = tracker.created  # not guessed, not dropped: asked (Focus → "Which job is this?")
        self.assertTrue(question['Needs you']['checkbox'])
        self.assertNotIn('Suggested job', question)
        self.assertIn('Zeta', sent[0])
        self.assertIn('which job', sent[0])

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
        prep = [m for m in sent if m.startswith('🗓 <b>Tomorrow')]
        self.assertEqual(len(prep), 1)
        self.assertIn('Postgres', prep[0])
        self.assertIn('With: Alex Morgan', prep[0])
        _, sent = self.run_mail(tracker, google, [], calendar=True)
        self.assertFalse([m for m in sent if m.startswith('🗓 <b>Tomorrow')])  # once only

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
        self.assertIn('caption "AG Talent, AG Talent role', asked[0])


class HuxleyFollowUpTests(unittest.TestCase):
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


class RunLogContractTests(unittest.TestCase):
    """The run dict main() logs and the page cron_runs writes must agree: this is the one place a check's own
    payload is rendered as Notion sees it."""

    def test_the_logged_run_renders_every_email_with_its_link_and_action(self):
        from src.notion import cron_runs
        stats = {'pending': 1, 'done': 1, 'usd': 0.0,
                 'updates': ['📬 Application received · Canonical — Site Reliability Engineer · Stage Applied → Confirmation received'],
                 'emails': [{'subject': 'Thank you for applying to Canonical', 'from': 'no-reply@us.greenhouse-mail.io',
                             'at': '2026-10-01T00:56:05+00:00', 'action': 'recorded',
                             'label': 'Canonical — Site Reliability Engineer',
                             'changes': 'Stage Applied → Confirmation received; Confirmation email set',
                             'link': 'https://mail.google.com/mail/u/0/#all/1a0f4f6224933d5c'}]}
        logged = {'mode': 'mail', 'started_at': '2026-10-01T01:18:00+00:00', 'warnings': [],
                  'mail': {k: v for k, v in stats.items() if k not in ('updates', 'emails')},
                  'updates': stats['updates'], 'emails': stats['emails']}  # exactly what main()'s log_check builds
        props, children = cron_runs.run_page(logged)
        self.assertEqual((props['Emails']['number'], props['Updates']['number']), (1, 1))
        line = next(b for b in children if b['type'] == 'bulleted_list_item'
                    and b['bulleted_list_item']['rich_text'][0]['text'].get('link'))
        self.assertIn('[recorded] · Canonical — Site Reliability Engineer · changed Stage Applied → '
                      'Confirmation received; Confirmation email set',
                      line['bulleted_list_item']['rich_text'][0]['text']['content'])
        self.assertEqual(line['bulleted_list_item']['rich_text'][0]['text']['link']['url'],
                         'https://mail.google.com/mail/u/0/#all/1a0f4f6224933d5c')
