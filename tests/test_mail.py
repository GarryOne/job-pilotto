"""The Gmail check (src/ai/mail.py and its mail_*.py pieces): queries, the stage ladder, state, short lines, limits, the run log.
Sibling files: test_mail_match, test_mail_calendar, test_mail_invites, test_mail_google."""
import contextlib
import io
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import mail, mail_inbox
from src.notion import ledger
from tests import zone
from tests.mail_fakes import (NOW, FakeClient, FakeGoogle, FakeTracker, MailCase, app, content, email, event_row, rec, record_of, result,
                              stores_for, text)

setUpModule, tearDownModule = zone.pinned()


class MailTests(MailCase):
    def test_query_covers_senders_subjects_and_tracked_companies(self):
        q = mail.query([record_of(app('a', 'Zephyr AI', 'Infra', via='TechTree'))], 2)
        self.assertTrue(q.startswith('newer_than:2d -in:chats'))
        self.assertNotIn('subject:', q)   # no words: other inbox mail is sorted by Claude (mail_triage), in any language
        for part in ('from:greenhouse-mail.io', 'from:techtree.dev', '"Zephyr AI"', '"TechTree"'):
            self.assertIn(part, q)

    def test_rejection_moves_stage_and_is_never_logged_twice(self):
        apps = [app('p1', 'Scale AI', 'Infrastructure Software Engineer')]
        tracker, google = FakeTracker(apps), FakeGoogle([email('m1', 'Update on your application', body='Thank you for your interest in Scale AI ...')])
        summary, sent = self.run_mail(tracker, google, [[result(0, 0, 'Rejected', 'Not moving forward')]])
        event = tracker.created[0]
        self.assertEqual((event['Kind']['select']['name'], event['Source']['select']['name']), ('Rejected', 'Gmail'))
        self.assertEqual(event['At']['date']['start'], '2026-09-26T09:00:00+02:00')  # the email's own time
        self.assertIn(('p1', {'Stage': {'select': {'name': 'Rejected'}}}), tracker.updates)
        self.assertIn('<b>Scale AI · Infrastructure Software Engineer · Rejected</b>', sent[0])
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
        with mock.patch('src.ai.mail_calendar.interview_stats', lambda s: {}):
            mail.run(tracker, google, client=FakeClient([[result(0, 0, 'Other', relevant=False)]]), days=2, send=sent.append,
                     calendar=False, now=NOW, state_path=self.state, stats={}, always_report=True)
        self.assertEqual(sent, ['📧 <b>Gmail checked</b>\n1 new email\n\nNothing that changes your applications.'])

    def test_a_quiet_check_without_that_flag_says_nothing(self):
        # The mail workflow no longer sets it (the app dispatches it for "Check Gmail now"): a check that recorded
        # nothing stays quiet on Telegram, and the app shows it in Recent activity.
        tracker, google = FakeTracker([app('p1', 'Acme', 'SRE')]), FakeGoogle([email('m1', 'Newsletter')])
        sent = []
        with mock.patch('src.ai.mail_calendar.interview_stats', lambda s: {}):
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
                         ['Gmail: reading new emails…', 'Updates:', '❌ Rejected · Grafana Labs — Staff Software Engineer - Databases SRE | Sweden'
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
        with mock.patch('src.ai.mail_calendar.interview_stats', lambda s: {}):
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
        self.assertEqual((content(update['Source ID']), update['At']), ('m2', {'date': {'start': '2026-09-26T01:26:30+02:00'}}))
        changes = json.loads(content(update['Changes']))
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
        with mock.patch.object(mail_inbox, 'classify', lambda *a, **k: {0: {
                **result(0, 0, 'Confirmation received', company='Canonical'), 'role': 'Site Reliability Engineer'}}), \
                mock.patch('src.ai.mail_calendar.interview_stats', lambda s: {}):
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
        self.assertEqual([r['id'] for r in mail.applications(stores_for(tracker))], ['p1', 'p2', 'x'])
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
        with mock.patch('src.ai.mail_calendar.interview_stats', lambda s: {'topics_answered_weakly': {}}):
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


class LimitTests(unittest.TestCase):
    def test_limit_reached(self):
        from src.ai import cost
        self.assertTrue(cost.limit_reached(Exception("You have reached your specified API usage limits.")))
        self.assertTrue(cost.limit_reached(Exception('Your credit balance is too low')))
        self.assertFalse(cost.limit_reached(Exception('overloaded')))


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


if __name__ == '__main__':
    unittest.main()
