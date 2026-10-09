"""Saved interviews: save then review in place, linking, the job line, titles, reviews without Telegram, insight stats.
Guards src/ai/interviews.py, interviews_blocks.py, interviews_apps.py, and the Notion page's job line (src/stores/notion_interviews.py).
"""
import unittest

from tests.interviews_fixtures import *  # noqa: F401,F403 — the shared fakes and fixtures
from tests.interviews_fixtures import setUpModule  # noqa: F401 (the model's answer)


class InterviewSavedTests(unittest.TestCase):
    def test_a_transcript_is_saved_then_reviewed_in_place(self):
        stores = store_with(job('g-1', 'Grafana Labs', 'Applied', '2026-09-20'))
        row = interviews.save(stores, SPOKEN, 'Grafana, round 1', job_url='https://x.test/g-1', now=NOW)
        saved = stores.interviews.get(row['id'])
        self.assertEqual((saved['app_id'], saved['input'], saved['overall'], saved['at']),
                         (app_id(stores, 'g-1'), 'Recording', '', '2026-09-26'))  # not reviewed: no AI was used
        self.assertEqual(saved['transcript'], SPOKEN)
        self.assertEqual(interviews.listing(stores)[0]['application'], [app_id(stores, 'g-1')])
        # Where the job is comes from the linked application.
        stores.applications.update(app_id(stores, 'g-1'), {'location': 'Zürich, Switzerland', 'work_mode': 'On-site'})
        self.assertEqual(interviews.listing(stores)[0]['place'], {'location': 'Zürich, Switzerland', 'work_mode': 'On-site'})
        # The Calendar's read skips the place (and the applications read behind it).
        with mock.patch.object(stores.applications, 'list', side_effect=AssertionError('no applications read')):
            self.assertEqual(interviews.listing(stores, places=False)[0]['place'], {})
        # A job not in Applications yet is added there first (an interview means you applied), then linked.
        newco = interviews.save(stores, SPOKEN, 'Newco call', job_url='https://jobs.test/newco', now=NOW)
        added = stores.applications.get('https://jobs.test/newco')
        self.assertTrue(added['date_approximate'])
        self.assertEqual(stores.interviews.get(newco['id'])['app_id'], added['id'])

        client = FakeClient()
        log = interviews.run(stores=stores, page_id=row['id'], client=client, now=NOW)
        self.assertIn('You: We drain nodes', client.calls[0]['messages'][0]['content'])
        self.assertIn('Caption: Grafana, round 1', client.calls[0]['messages'][0]['content'])
        self.assertIn('Grafana Labs', log)
        reviewed = stores.interviews.get(row['id'])
        self.assertEqual((reviewed['overall'], reviewed['app_id'], reviewed['at']), ('positive', app_id(stores, 'g-1'), '2026-09-26'))
        self.assertIn('Strengths', reviewed['review'])
        self.assertEqual(reviewed['transcript'], SPOKEN)  # the review kept the transcript
        self.assertEqual(len(stores.interviews.list()), 2)  # the review added no interview (2 = the two saves above)
        self.assertEqual(reviewed['input'], 'Recording')  # kept, not "Transcript"
        # Saving a recorded call moves its job on at once; the review then adds the next step.
        grafana = stores.applications.get('https://x.test/g-1')
        self.assertEqual((grafana['stage'], grafana['next_step']), ('Interviewing', 'System design next week'))
        self.assertEqual(stores.applications.get('https://jobs.test/newco')['stage'], 'Interviewing')

    def test_the_interview_made_when_the_transcript_was_ready_is_updated_by_save_not_duplicated(self):
        stores = store_with(job('g-1', 'Grafana Labs', 'Applied', '2026-09-20'))
        first = interviews.save(stores, SPOKEN, 'Interview 28 Sep 10:00', now=NOW)  # right after transcription
        named = SPOKEN.replace('Speaker 1', 'Anna (recruiter)')
        interviews.save(stores, named, 'Grafana, round 1', job_url='https://x.test/g-1', page_id=first['id'], now=NOW)
        self.assertEqual(len(stores.interviews.list()), 1)
        row = stores.interviews.get(first['id'])
        self.assertEqual((row['title'], row['app_id'], row['transcript']), ('Grafana, round 1', app_id(stores, 'g-1'), named.strip()))

    def test_linking_a_saved_interview_to_another_job(self):
        stores = store_with(job('g-1', 'Grafana Labs', 'Applied', '2026-09-20'), job('s-1', 'Acme', 'Saved', ''))
        row = interviews.save(stores, SPOKEN, 'Call', now=NOW)
        self.assertEqual(stores.interviews.get(row['id'])['app_id'], '')
        self.assertEqual(interviews.link(stores, row['id'], 'https://x.test/s-1'), app_id(stores, 's-1'))
        self.assertEqual(stores.interviews.get(row['id'])['app_id'], app_id(stores, 's-1'))
        self.assertEqual(stores.applications.get('https://x.test/s-1')['stage'], 'Interviewing')  # the call was held
        interviews.link(stores, row['id'])
        self.assertEqual(stores.interviews.get(row['id'])['app_id'], '')

    def test_delete_archives_the_interview(self):
        stores = store_with()
        row = interviews.save(stores, SPOKEN, 'Call', now=NOW)
        with mock.patch('sys.stdout', io.StringIO()) as out, \
                mock.patch.object(interviews, 'open_for_commands', return_value=(stores, None)):
            self.assertEqual(interviews.main(['delete', row['id']]), 0)
        self.assertEqual(json.loads(out.getvalue()), {'ok': True})
        self.assertEqual(stores.interviews.list(), [])

    @staticmethod
    def first_line(tracker, page_id):
        rich = tracker.blocks[page_id][0]['paragraph']['rich_text']
        return ''.join(t['plain_text'] for t in rich), [t['text'].get('link') for t in rich]

    def test_a_job_line_tops_every_notion_interview_page_and_follows_the_link(self):
        from src.stores.notion_interviews import NotionInterviews
        tracker = NotionPages([app('g-1', 'Grafana Labs', 'Applied', '2026-09-20'), app('s-1', 'Acme', 'Saved', '')])
        pages = NotionInterviews(tracker, database_id=interviews.INTERVIEWS_DATABASE_ID)
        page = pages.save(None, {'title': 'Call', 'transcript': SPOKEN})
        self.assertEqual(self.first_line(tracker, page['id'])[0], '🔗 No job linked yet — link it in the Interviews page of the Job Pilotto app')
        pages.save(page['id'], {'app_id': 'g-1'})
        text_, links = self.first_line(tracker, page['id'])
        self.assertEqual(text_, '🔗 Job: Grafana Labs · SRE')
        self.assertEqual(links[1], {'url': 'https://www.notion.so/g1'})
        pages.save(page['id'], {'app_id': 's-1'})  # changed: replaced, never duplicated
        pages.save(page['id'], {'app_id': 's-1'})  # again: idempotent
        lines = [b for b in tracker.blocks[page['id']] if b['type'] == 'paragraph' and b['paragraph']['rich_text'][0]['plain_text'].startswith('🔗')]
        self.assertEqual(len(lines), 1)
        self.assertEqual(self.first_line(tracker, page['id'])[0], '🔗 Job: Acme · SRE')
        pages.save(page['id'], {'app_id': ''})
        self.assertIn('No job linked yet', self.first_line(tracker, page['id'])[0])
        # A review keeps the line first, once.
        pages.save(page['id'], {'app_id': 'g-1', 'review': 'Went well.\n\n### Strengths\n\n- calm'})
        self.assertEqual(self.first_line(tracker, page['id'])[0], '🔗 Job: Grafana Labs · SRE')
        self.assertEqual(sum(b['paragraph']['rich_text'][0]['plain_text'].startswith('🔗') for b in tracker.blocks[page['id']]
                             if b['type'] == 'paragraph'), 1)
        made = pages.save(None, {'title': 'Held', 'app_id': 'g-1', 'transcript': 'Notes about the call'})
        self.assertEqual(self.first_line(tracker, made['id'])[0], '🔗 Job: Grafana Labs · SRE')

    def test_the_title_uses_a_named_employer_else_via_else_the_job_else_the_round(self):
        job_of = lambda **fields: {'id': 'a', 'company': '', 'via': '', 'title': '', **fields}
        self.assertEqual(interviews.interview_title('Grafana Labs', 'Technical 1'), 'Grafana Labs · Technical 1')
        self.assertEqual(interviews.interview_title('', 'Recruiter screen', job_of(via='Huxley', title='Principal SRE')), 'Huxley · Recruiter screen')
        self.assertEqual(interviews.interview_title('', 'Recruiter screen', job_of(title='Principal SRE')), 'Principal SRE · Recruiter screen')
        self.assertEqual(interviews.interview_title('', 'Recruiter screen'), 'Recruiter screen')
        self.assertEqual(interviews.interview_title('Acme', 'HM', job_of(company='Other')), 'Acme · HM')
        placeholder = '(unnamed finance client via recruiter — Principal SRE posting)'
        self.assertEqual(interviews.named(placeholder), '')
        self.assertEqual(interviews.named('Unknown company'), '')
        self.assertEqual(interviews.named('x' * 61), '')
        self.assertEqual(interviews.named('Grafana Labs'), 'Grafana Labs')
        self.assertEqual(interviews.interview_title(placeholder, 'Recruiter screen', job_of(via='Huxley')), 'Huxley · Recruiter screen')

    def test_the_app_reviews_without_telegram(self):
        from src import daily, daily_modes
        argv = ['daily', '--mode', 'interview', '--interview', 'iv-1']
        env = {k: v for k, v in daily.os.environ.items() if k not in ('TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID')}
        with mock.patch.object(sys, 'argv', argv), mock.patch.dict(daily.os.environ, env, clear=True), \
                mock.patch.object(daily.telegram, 'keychain_token', return_value=None), \
                mock.patch.object(daily.notion.Tracker, 'from_env', return_value=FakeTracker([])), \
                mock.patch.object(daily_modes, 'log_ai_run'), \
                mock.patch.object(daily.interviews, 'run', return_value='Interview analysed (x) https://n.test/1') as run, \
                mock.patch('sys.stdout', io.StringIO()):
            self.assertEqual(daily.main(), 0)
        self.assertEqual(run.call_args.kwargs['page_id'], 'iv-1')
        self.assertIsNone(run.call_args.kwargs['send'])

    def test_stats_for_insights(self):
        from src.ai.insights_data import interview_stats
        stores = store_with()
        stores.interviews.save(None, {'title': 'A', 'topics': 'Kubernetes; Postgres', 'weak_topics': 'Postgres', 'overall': 'positive'})
        stores.interviews.save(None, {'title': 'B', 'topics': 'Postgres', 'weak_topics': 'Postgres', 'overall': 'neutral'})
        stores.interviews.save(None, {'title': 'Not reviewed', 'topics': 'Go'})
        stats = interview_stats(stores)
        self.assertEqual(stats['topics_asked'], {'Postgres': 2, 'Kubernetes': 1})
        self.assertEqual(stats['topics_answered_weakly'], {'Postgres': 2})
        self.assertEqual(stats['overall'], {'positive': 1, 'neutral': 1, 'negative': 0})


if __name__ == '__main__':
    unittest.main()
