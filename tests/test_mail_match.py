"""Which job an email belongs to, or asking the owner (src/ai/mail_match.py, mail_leads.py, mail_lines.py ask).
See also test_mail.py."""
import base64
import io
import json
from pathlib import Path
import sys
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import mail
from src.notion import ledger
from src.sources import google as google_api
from tests import zone
from tests.mail_fakes import NOW, FakeClient, FakeGoogle, FakeTracker, MailCase, app, content, email, result, text

setUpModule, tearDownModule = zone.pinned()


class MailMatchTests(MailCase):
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
        self.assertIn('Which job is this for?', sent[0])
        self.assertIn('Rejected · Grafana Labs', stats['updates'][0])
        self.assertFalse([u for u in tracker.updates if 'Stage' in u[1]])  # no job moved on a guess

    def test_a_role_named_in_email_but_not_tracked_is_asked_about_not_created(self):
        # 7 Oct 2026: a photographer's Gmail check created two Anthropic SRE applications from the inbox's past (a Gmail link as the posting,
        # fit 5). No job found for an email: Focus asks "Which job?" (a job, a new job or none); nothing is created by itself.
        apps = [app('p1', 'Grafana Labs', 'Staff SRE | Sweden | Remote')]
        google = FakeGoogle([email('c1', 'Thank you for applying to Grafana Labs', '2026-09-25T09:00:00+02:00'),
                             email('r1', 'Your application for Grafana Labs', '2026-09-26T07:00:00+02:00')])
        tracker, stats = FakeTracker(apps), {}
        spain = dict(company='Grafana Labs', role='Staff SRE | Spain | Remote')
        with mock.patch('src.ai.interviews.stats_for_insights', lambda t: {'topics_answered_weakly': {}}):
            mail.run(tracker, google, client=FakeClient([[{**result(0, -1, 'Confirmation received'), **spain},
                                                          {**result(1, -1, 'Rejected'), **spain}]]),
                     days=2, send=[].append, calendar=False, now=NOW, state_path=self.state, stats=stats)
        self.assertEqual([p for p in tracker.created if 'Stage' in p], [], 'no application created by itself')
        asked = [p for p in tracker.created if 'Needs you' in p]
        self.assertEqual(len(asked), 2)
        self.assertTrue(all(p['Event']['title'][0]['text']['content'].startswith('❓ Which job?') for p in asked))
        self.assertNotIn({'Stage': {'select': {'name': 'Rejected'}}}, [u for _, u in tracker.updates], 'the tracked Sweden role is not touched')
        self.assertTrue(any(line.startswith('❓') for line in stats['updates']))

    def test_a_role_on_the_list_but_never_marked_applied_becomes_the_application(self):
        # Saved, Kit ready and Applying are among the jobs the reader matches (mail.applications); a role outside them
        # (dismissed, then applied to without marking it) is found by the check's scan of every row.
        kit_ready = app('k1', 'Grafana Labs', 'Staff SRE | Spain | Remote', stage='Dismissed', applied='')
        tracker, stats = FakeTracker([app('p1', 'Grafana Labs', 'Staff SRE | Sweden | Remote'), kit_ready]), {}
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
        self.assertIn(('p1', 'Blinq'), [(p, content(u['Company'])) for p, u in tracker.updates if 'Company' in u])  # the lead learns its employer

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

    def test_query_also_asks_for_agencies_and_invitations(self):
        q = mail.query([], 2)
        extra = mail.extra_query(2)
        self.assertIn('from:huxley.com', extra)
        self.assertIn('filename:invite.ics', extra)
        self.assertNotIn('huxley', q)  # a second, short search: the first one stays within Gmail's limit

    def test_invitation_mails_are_searched_by_their_google_wrappers_too(self):
        extra = mail.extra_query(2)
        self.assertIn('from:calendar-notification@google.com', extra)
        self.assertIn('subject:"Invitation from an unknown sender"', extra)

    def test_a_meeting_invitation_the_ai_calls_irrelevant_is_asked_about_not_dropped(self):
        # 2 Oct 2026: two Calendly bookings from "Blockdaemon DM" were read and silently skipped as "not about your applications".
        tracker = FakeTracker([app('p9', '', 'Senior Web3 Infrastructure / DevOps Engineer', stage='Screening', contact='Linomica Irigoyen')])
        invite = {**email('b1', 'Invitation from an unknown sender: Igor Mardari and Blockdaemon DM @ Mon 5 Oct 2026 10:45',
                          '2026-09-26T09:00:00+02:00', sender='Blockdaemon DM <x@gmail.com>', body='Google Meet'),
                  'invite_at': '2026-10-05T10:45:00+02:00'}
        receipt = email('r1', 'Your receipt', sender='billing@shop.test')
        with mock.patch('src.ai.opportunity.track', side_effect=RuntimeError('must not create a job')), \
                mock.patch('src.ai.opportunity.extract', side_effect=RuntimeError('must not create a job')):
            _, sent = self.run_mail(tracker, FakeGoogle([invite, receipt]),
                                    [[result(0, -1, 'Other', relevant=False), result(1, -1, 'Other', relevant=False)]])
        self.assertEqual(len(tracker.created), 1)  # the receipt stays skipped
        self.assertTrue(tracker.created[0]['Needs you']['checkbox'])
        self.assertIn('Which job', tracker.created[0]['Event']['title'][0]['text']['content'])
        self.assertEqual(tracker.updates, [])
        self.assertIn('Which job is this for?', ' '.join(sent))

    def test_an_invitation_whose_calendar_file_could_not_be_read_is_still_asked_about(self):
        self.assertTrue(mail._unread_invitation(email('b3', 'Invitation from an unknown sender: Igor and Acme DM @ Mon 5 Oct')))
        self.assertFalse(mail._unread_invitation(email('b4', 'Notification: Igor and Acme DM @ Mon 5 Oct')))

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
        self.assertIn('Which job is this for?', sent[0])

    def test_the_which_job_message_escapes_a_company_name_once(self):
        # #279: _label() already escapes; escaping it again showed "AT&amp;T" to the owner in Telegram.
        tracker = FakeTracker([app('p1', 'Scale AI', 'SRE')])
        google = FakeGoogle([email('h2', 'Connect Igor - SRE', sender='Jaya <j@att.test>')])

        def track(tracker_, lead, text_, **options):
            return app('new-lead', 'AT&T', lead['title'], stage='Screening', via=lead.get('recruiter_company', '')), ''
        with mock.patch('src.ai.opportunity.extract', side_effect=RuntimeError('no AI in tests')), \
                mock.patch('src.ai.opportunity.track', track):
            _, sent = self.run_mail(tracker, google, [[result(0, -1, 'Interview scheduled', company='AT&T',
                                                              interview_at='2026-09-30T08:30:00+02:00')]])
        message = ' '.join(sent)
        self.assertIn('AT&amp;T', message)
        self.assertNotIn('AT&amp;amp;T', message)

    def test_irrelevant_and_untracked_mail(self):
        tracker = FakeTracker([app('p1', 'Scale AI', 'SRE')])
        google = FakeGoogle([email('m5', 'Jobs you may like'), email('m6', 'Thanks for applying to Zeta')])
        _, sent = self.run_mail(tracker, google, [[result(0, -1, 'Other', relevant=False),
                                                   result(1, -1, 'Confirmation received', company='Zeta', summary='Applied')]])
        [question] = tracker.created  # not guessed, not dropped: asked (Focus → "Which job is this?")
        self.assertTrue(question['Needs you']['checkbox'])
        self.assertFalse((question.get('Suggested job') or {}).get('url'))
        self.assertIn('Zeta', sent[0])
        self.assertIn('Which job is this for?', sent[0])


if __name__ == '__main__':
    unittest.main()
