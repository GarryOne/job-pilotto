import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import desktop
from src.ai import mail, opportunity
from tests.test_mail import NOW, FakeGoogle, FakeTracker, app, email, result

EMAIL_PITCH = """Hi Sam,

A logistics software company whose platform runs live warehouse operations is adding a second Senior DevOps
Engineer. Fully remote across Europe on a B2B contract. €70,000 to €90,000, maybe €100,000 plus equity.

Would you be open to hearing more?

Alex Morgan, Founder | Tech Recruiter, Example Talent, alex@example-talent.test"""
EMAIL_LEAD = {'is_opportunity': True, 'title': 'Senior DevOps Engineer', 'company': '', 'client': 'logistics software, Series A',
              'location': 'Remote (Europe)', 'work_mode': 'Remote', 'salary': '€70k–90k (maybe €100k) + equity',
              'contract': 'B2B contract', 'recruiter_name': 'Alex Morgan', 'recruiter_email': 'alex@example-talent.test',
              'recruiter_company': 'Example Talent', 'in_house': False, 'platform': 'Email', 'job_url': '', 'summary': 'AWS, EKS, Aurora',
              'owner_agreed': False}
CHAT_PITCH = """Jordan Lee: Hi Sam, I'm currently looking for a remote SRE for Acme Robotics (a new seed-stage startup).
120-220K EUR, 1 day every other month in Vienna. Could this be interesting?
Sam Example: Yes"""
CHAT_LEAD = dict(EMAIL_LEAD, title='Site Reliability Engineer', company='Acme Robotics', client='', location='Remote, Vienna monthly',
                 salary='€120k–220k', contract='', recruiter_name='Jordan Lee', recruiter_email='',
                 recruiter_company='Sample Search Partners', platform='LinkedIn', owner_agreed=True)


class Client:
    """Anthropic client double: answers each call with the next canned JSON."""

    def __init__(self, *answers):
        self.answers, self.calls, self.messages = list(answers), [], self

    def create(self, **params):
        self.calls.append(params)
        return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps(self.answers.pop(0)))],
                               usage=SimpleNamespace(input_tokens=900, output_tokens=200, cache_read_input_tokens=0,
                                                     cache_creation_input_tokens=0))


class Tracker(FakeTracker):
    def __init__(self, apps=(), events=()):
        super().__init__(list(apps), events)
        self.bodies = {}

    def find(self, url):
        return next((p for p in self.created if p.get('Job URL', {}).get('url') == url), None)

    def create_page(self, database_id, properties):
        page = super().create_page(database_id, properties)
        return dict(page, url=f"https://notion.test/{page['id']}")

    def replace_after_heading(self, page_id, heading, blocks):
        self.bodies[page_id] = (heading, blocks)


class OpportunityTests(unittest.TestCase):
    def test_a_recruiter_email_becomes_a_recruiter_lead_with_the_message_on_its_page(self):
        tracker, client = Tracker(), Client(EMAIL_LEAD)
        line = opportunity.add_from_text(tracker, EMAIL_PITCH, client=client)
        row, event = tracker.created
        self.assertEqual(row['Stage'], {'select': {'name': 'Recruiter lead'}})
        self.assertEqual(row['Channel'], {'select': {'name': 'Agency'}})
        self.assertEqual(row['Via']['rich_text'][0]['text']['content'], 'Example Talent')
        self.assertEqual(row['Contact']['rich_text'][0]['text']['content'], 'Alex Morgan · alex@example-talent.test')
        self.assertEqual(row['Company'], {'rich_text': []})  # hidden employer: nothing for the Gmail check to mis-match
        self.assertIn('Client: logistics software', row['Notes']['rich_text'][0]['text']['content'])
        self.assertEqual(row['Work mode'], {'select': {'name': 'Remote'}})
        self.assertEqual(event['Kind'], {'select': {'name': 'Recruiter lead'}})
        heading, blocks = tracker.bodies['new-1']
        self.assertEqual(heading, opportunity.HEADING)
        self.assertIn('Would you be open', json.dumps(blocks, ensure_ascii=False))
        self.assertIn('Senior DevOps Engineer — logistics software, Series A (client) via Example Talent', line)
        self.assertIn('(Recruiter lead)', line)

    def test_pasting_the_same_message_twice_keeps_one_row(self):
        tracker = Tracker()
        opportunity.add_from_text(tracker, EMAIL_PITCH, client=Client(EMAIL_LEAD))
        again = opportunity.add_from_text(tracker, EMAIL_PITCH + '\n', client=Client(EMAIL_LEAD))
        self.assertTrue(again.startswith('Already tracked'))
        self.assertEqual(len([p for p in tracker.created if 'Stage' in p]), 1)

    def test_a_conversation_where_the_owner_said_yes_starts_at_screening(self):
        tracker = Tracker()
        line = opportunity.add_from_text(tracker, CHAT_PITCH, client=Client(CHAT_LEAD))
        row = tracker.created[0]
        self.assertEqual(row['Stage'], {'select': {'name': 'Screening'}})
        self.assertTrue(row['Job URL']['url'].startswith('https://www.linkedin.com/messaging/#jp-'))
        self.assertEqual([p['Kind']['select']['name'] for p in tracker.created[1:]], ['Recruiter lead', 'Screening'])
        self.assertIn('Acme Robotics', line)

    def test_short_text_and_non_pitches_are_refused_without_writing(self):
        tracker = Tracker()
        with self.assertRaisesRegex(ValueError, 'whole recruiter message'):
            opportunity.add_from_text(tracker, 'on or before 23 Sep', client=Client())
        with self.assertRaisesRegex(ValueError, "doesn't read like"):
            opportunity.add_from_text(tracker, 'Your weekly job alert: 25 new DevOps jobs near Zurich …',
                                      client=Client(dict(EMAIL_LEAD, is_opportunity=False)))
        self.assertEqual(tracker.created, [])

    def test_a_posting_link_in_the_message_is_the_job_url(self):
        lead = dict(EMAIL_LEAD, job_url='https://jobs.ashbyhq.com/acme/1')
        self.assertEqual(opportunity.lead_url(lead, EMAIL_PITCH), 'https://jobs.ashbyhq.com/acme/1')
        self.assertEqual(opportunity.lead_url(EMAIL_LEAD, EMAIL_PITCH, 'm42'), 'https://mail.google.com/mail/u/0/#all/m42')

    def test_the_app_lists_a_lead_as_saved_until_you_are_talking(self):
        self.assertEqual(desktop.stage_status('Recruiter lead'), 'saved')
        self.assertEqual(desktop.stage_status('Screening'), 'applied')


class MailOutreachTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.state = Path(self.tmp.name) / 'state.json'

    def tearDown(self):
        self.tmp.cleanup()

    def run_mail(self, tracker, google, classified, *leads):
        client = Client(*([{'results': r} for r in classified] + list(leads)))
        sent = []
        summary = mail.run(tracker, google, client=client, days=2, send=sent.append, calendar=False, now=NOW,
                           state_path=self.state, stats={})
        return summary, sent, client

    def test_a_recruiters_first_email_becomes_a_lead_and_telegram_says_so(self):
        tracker = Tracker([app('p1', 'Scale AI', 'Infrastructure Engineer')])
        google = FakeGoogle([email('m1', 'DevOps Engineer - Fully Remote', sender='Alex Morgan <alex@example-talent.test>')])
        _, sent, client = self.run_mail(tracker, google, [[result(0, -1, mail.OUTREACH, company='Example Talent')]], EMAIL_LEAD)
        row, event = tracker.created[0], tracker.created[1]
        self.assertEqual(row['Source'], {'select': {'name': 'Gmail'}})
        self.assertEqual(row['Job URL']['url'], 'https://mail.google.com/mail/u/0/#all/m1')
        self.assertEqual(event['At'], {'date': {'start': '2026-09-26T09:00:00+02:00'}})
        self.assertIn(('new-2', {'Source ID': {'rich_text': [{'text': {'content': 'm1'}}]}}), tracker.updates)
        self.assertIn('🤝 New recruiter lead: <b>Senior DevOps Engineer', sent[0])
        self.assertIn('Recruiter outreach', client.calls[0]['system'][0]['text'])

    def test_the_recruiters_follow_up_is_a_reply_on_the_lead_not_a_second_lead(self):
        lead = app('p9', '', 'Site Reliability Engineer', stage='Recruiter lead', via='Sample Search Partners', contact='Jordan Lee')
        tracker = Tracker([lead])
        google = FakeGoogle([email('m2', 'Should we chat about the role?', sender='Jordan Lee <jordan@sample-search.test>')])
        self.run_mail(tracker, google, [[result(0, 0, mail.OUTREACH)]])
        self.assertEqual([p['Kind']['select']['name'] for p in tracker.created], ['Reply received'])

    def test_the_search_includes_linkedin_message_emails_and_the_users_role_searches(self):
        with mock.patch('src.paths.load_search_config', lambda: {'jobs_board_search_queries': ['site reliability engineer']}):
            q = mail.query([], 2)
        for part in ('from:messages-noreply@linkedin.com', 'subject:"opportunity"', 'subject:"site reliability engineer"'):
            self.assertIn(part, q)

    def test_recruiter_leads_are_among_the_applications_emails_can_belong_to(self):
        tracker = Tracker()
        filters = []
        tracker.query_database = lambda db, f=None: filters.append(f) or []
        mail.applications(tracker)
        self.assertIn({'property': 'Stage', 'select': {'equals': 'Recruiter lead'}}, filters[0]['or'])


class DailyAddTests(unittest.TestCase):
    def test_add_mode_without_a_job_link_tracks_the_message_as_a_lead(self):
        from src import daily
        tracker = Tracker()
        argv = ['daily', '--mode', 'add', '--action', 'talking', '--note', EMAIL_PITCH]
        with mock.patch.object(sys, 'argv', argv), mock.patch.object(daily.notion.Tracker, 'from_env', lambda: tracker), \
                mock.patch.object(opportunity, 'extract', lambda *a, **k: EMAIL_LEAD), \
                mock.patch.dict('os.environ', {'ANTHROPIC_API_KEY': 'sk-test'}), \
                mock.patch.dict(sys.modules, {'anthropic': SimpleNamespace(Anthropic=lambda: None)}), \
                mock.patch.object(daily, 'queue_mail_check', lambda: False), mock.patch('builtins.print') as printed:
            self.assertEqual(daily.main(), 0)
        self.assertEqual(tracker.created[0]['Stage'], {'select': {'name': 'Screening'}})
        self.assertIn('🤝 Tracked recruiter lead', printed.call_args_list[-1].args[0])


if __name__ == '__main__':
    unittest.main()
