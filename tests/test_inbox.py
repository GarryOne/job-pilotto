import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import inbox
from tests.test_mail import NOW, event_row
from tests.test_opportunity import EMAIL_LEAD, Client, Tracker

SHOT = ('shot.png', b'\x89PNG fake screenshot bytes', 'image/png')


def reading(kind, match=-1, **fields):
    return dict(EMAIL_LEAD, kind=kind, match=match, role=fields.pop('role', ''), when=fields.pop('when', ''),
                interview_at=fields.pop('interview_at', ''), **fields)


def job(url, title, company='', stage=None, via='', contact='', fit=None):
    return {'url': url, 'title': title, 'company': company, 'location': '', 'stage': stage, 'via': via,
            'contact': contact, 'fit': fit, 'match_status': None if stage else 'New'}


def row(page_id, url, title, company='', stage='Applied'):
    return {'id': page_id, 'url': f'https://notion.test/{page_id}', 'properties': {
        'Company': {'type': 'rich_text', 'rich_text': [{'plain_text': company}]},
        'Job': {'type': 'title', 'title': [{'plain_text': title}]}, 'Job URL': {'type': 'url', 'url': url},
        'Stage': {'type': 'select', 'select': {'name': stage}}, 'Next interview': {'type': 'date', 'date': None}}}


class Inbox(Tracker):
    """Applications rows + the merged job list (notion_jobs), with uploads and appended page blocks recorded."""

    def __init__(self, rows=(), jobs=(), events=()):
        super().__init__(list(rows), events)
        self.jobs, self.appended, self.uploads = list(jobs), [], []

    def notion_jobs(self):
        return self.jobs

    def find(self, url):
        return next((r for r in self.apps if r['properties']['Job URL']['url'] == url), None) or super().find(url)

    def upload_file(self, name, data, content_type):
        self.uploads.append(name)
        return 'upload-1'

    def append_blocks(self, page_id, blocks):
        self.appended.append((page_id, blocks))


def run(tracker, answer, **options):
    options.setdefault('text', '')
    options.setdefault('image', SHOT)
    return inbox.log(tracker, client=Client(answer), now=NOW, **options)


class InboxTests(unittest.TestCase):
    def test_a_rejection_screenshot_updates_the_tracked_job_and_keeps_the_screenshot_on_its_page(self):
        tracker = Inbox([row('p1', 'https://x.test/1', 'SRE', 'Grafana Labs')],
                        [job('https://x.test/1', 'SRE', 'Grafana Labs', 'Applied'), job('https://x.test/2', 'SRE', 'Acme')])
        line = run(tracker, reading('Rejected', 0, summary='Not moving forward'))
        self.assertIn(('p1', {'Stage': {'select': {'name': 'Rejected'}}}), tracker.updates)
        self.assertEqual(tracker.created[0]['Kind'], {'select': {'name': 'Rejected'}})
        page, blocks = tracker.appended[0]
        self.assertEqual((page, blocks[-1]['type']), ('p1', 'image'))
        self.assertTrue(line.startswith('❌ Updated: Grafana Labs — SRE → Rejected'))

    def test_the_same_screenshot_twice_changes_nothing(self):
        tracker = Inbox([row('p1', 'https://x.test/1', 'SRE', 'Grafana Labs')], [job('https://x.test/1', 'SRE', 'Grafana Labs', 'Applied')])
        run(tracker, reading('Rejected', 0))
        source_id = next(u['Source ID'] for _, u in tracker.updates if 'Source ID' in u)['rich_text'][0]['text']['content']
        self.assertTrue(source_id.startswith('paste:'))
        tracker.events = [event_row('p1', 'Rejected', NOW.isoformat(), source_id)]
        line = run(tracker, reading('Rejected', 0))
        self.assertTrue(line.startswith('ℹ️ Already logged'))

    def test_a_new_screenshot_of_the_same_pitch_finds_the_lead_even_when_claude_does_not(self):
        lead = job('https://lead.test/1', 'Senior DevOps Engineer', '', 'Recruiter lead', via='Example Talent',
                   contact='Alex Morgan · alex@example-talent.test')
        tracker = Inbox([row('p9', 'https://lead.test/1', 'Senior DevOps Engineer', stage='Recruiter lead')], [lead])
        line = run(tracker, reading('Recruiter outreach', -1), image=('again.png', b'other pixels', 'image/png'))
        self.assertTrue(line.startswith('ℹ️ Already tracked'))
        self.assertEqual(tracker.created, [])

    def test_saying_yes_later_moves_the_lead_to_screening(self):
        lead = job('https://lead.test/1', 'Senior DevOps Engineer', '', 'Recruiter lead', via='Example Talent')
        tracker = Inbox([row('p9', 'https://lead.test/1', 'Senior DevOps Engineer', stage='Recruiter lead')], [lead])
        line = run(tracker, reading('Recruiter outreach', 0, owner_agreed=True))
        self.assertIn(('p9', {'Stage': {'select': {'name': 'Screening'}}}), tracker.updates)
        self.assertIn('→ Screening', line)

    def test_a_pitch_for_an_open_job_tracks_that_job_as_a_lead(self):
        tracker = Inbox([], [job('https://jobs.test/42', 'Platform Engineer', 'Acme', fit=80)])
        line = run(tracker, reading('Recruiter outreach', 0))
        self.assertEqual(tracker.created[0]['Job URL'], {'url': 'https://jobs.test/42'})
        self.assertEqual(tracker.created[0]['Company']['rich_text'][0]['text']['content'], 'Acme')
        self.assertEqual(tracker.uploads, ['shot.png'])
        self.assertTrue(line.startswith('🤝 Tracked recruiter lead: Platform Engineer — Acme'))

    def test_an_unknown_new_pitch_is_a_new_lead_and_sales_pitches_are_refused(self):
        tracker = Inbox()
        self.assertIn('Tracked recruiter lead', run(tracker, reading('Recruiter outreach')))
        with self.assertRaisesRegex(ValueError, "doesn't look like a message about a job"):
            run(Inbox(), reading('Not job-related'))

    def test_a_reply_for_a_role_nobody_tracks_needs_a_company_and_role(self):
        with self.assertRaisesRegex(ValueError, "can't tell which company and role"):
            run(Inbox(), reading('Rejected', company='', recruiter_company='', role='', title=''))
        tracker = Inbox()
        line = run(tracker, reading('Rejected', company='Globex', role='Staff SRE', recruiter_name='', in_house=True))
        self.assertEqual(tracker.created[0]['Stage'], {'select': {'name': 'Applied'}})
        self.assertEqual([p['Kind']['select']['name'] for p in tracker.created[1:]], ['Applied', 'Rejected'])
        self.assertIn('Tracked: Globex — Staff SRE → Rejected', line)

    def test_you_can_say_which_job_or_new(self):
        jobs = [job('https://x.test/1', 'SRE', 'Grafana Labs', 'Applied'), job('https://x.test/2', 'SRE', 'Acme', 'Applied')]
        rows = [row('p1', 'https://x.test/1', 'SRE', 'Grafana Labs'), row('p2', 'https://x.test/2', 'SRE', 'Acme')]
        tracker = Inbox(rows, jobs)
        line = run(tracker, reading('Interview scheduled', 0, interview_at='2026-10-01T10:00:00+02:00'), target='https://x.test/2')
        self.assertIn('Acme — SRE → Interview scheduled', line)
        tracker = Inbox(rows, jobs)
        self.assertIn('Tracked recruiter lead', run(tracker, reading('Recruiter outreach', 0), target='new'))

    def test_short_text_without_a_screenshot_is_refused(self):
        with self.assertRaisesRegex(ValueError, 'whole message or a screenshot'):
            inbox.log(Inbox(), text='ok', client=Client())

    def test_screenshot_files(self):
        self.assertIsNone(inbox.load_image('notes.txt'))


class DailyAddTests(unittest.TestCase):
    def test_add_mode_without_a_job_link_logs_the_message_and_the_app_can_say_which_job(self):
        from types import SimpleNamespace
        from unittest import mock
        from src import daily
        from tests.test_opportunity import EMAIL_PITCH
        tracker, seen = Inbox(), {}

        def read(client, model, text, image, jobs, stats=None):
            seen['text'] = text
            return reading('Recruiter outreach')
        argv = ['daily', '--mode', 'add', '--action', 'talking', '--target', 'new', '--note', EMAIL_PITCH]
        with mock.patch.object(sys, 'argv', argv), mock.patch.object(daily.notion.Tracker, 'from_env', lambda: tracker), \
                mock.patch.object(inbox, 'read', read), mock.patch.dict('os.environ', {'ANTHROPIC_API_KEY': 'sk-test'}), \
                mock.patch.dict(sys.modules, {'anthropic': SimpleNamespace(Anthropic=lambda: None)}), \
                mock.patch.object(daily, 'queue_mail_check', lambda: False), mock.patch('builtins.print') as printed:
            self.assertEqual(daily.main(), 0)
        self.assertEqual(seen['text'], EMAIL_PITCH)
        self.assertEqual(tracker.created[0]['Stage'], {'select': {'name': 'Screening'}})
        self.assertIn('Tracked recruiter lead', printed.call_args_list[-1].args[0])

    def test_an_ai_run_prints_its_notion_row_for_the_apps_link(self):
        from types import SimpleNamespace
        from unittest import mock
        from src import daily
        run = daily.new_cron_run('insight')
        with mock.patch.object(daily.cron_runs, 'log_run', lambda tracker, r: 'https://notion.test/run-1'), \
                mock.patch('builtins.print') as printed:
            daily.log_ai_run(object(), run, SimpleNamespace(send=False, log_run=True))
        printed.assert_called_with('Cronjob run logged: https://notion.test/run-1')

    def test_the_log_gets_plain_text_not_telegram_html(self):
        from src import daily
        self.assertEqual(daily.log_text("⚠️ That doesn&#x27;t look like <b>a job</b> &amp; so on"),
                         "⚠️ That doesn't look like a job & so on")


if __name__ == '__main__':
    unittest.main()
