"""Saved interviews: save then review in place, linking, the job line, titles, reviews without Telegram, insight stats.
Guards src/ai/interviews.py, interviews_blocks.py, interviews_store.py.
"""
import unittest

from tests.interviews_fixtures import *  # noqa: F401,F403 — the shared fakes and fixtures
from tests.interviews_fixtures import setUpModule  # noqa: F401 (the model's answer)


class InterviewSavedTests(unittest.TestCase):
    def test_a_transcript_is_saved_to_notion_then_reviewed_in_place(self):
        grafana = app('g-1', 'Grafana Labs', 'Applied', '2026-09-20')
        tracker = NotionPages([grafana])
        page = interviews.save(tracker, SPOKEN, 'Grafana, round 1', job_url='https://x.test/g-1', now=NOW)
        created = tracker.requests[0]
        self.assertEqual(created['parent'], {'database_id': interviews.INTERVIEWS_DATABASE_ID})
        self.assertEqual(created['properties']['Application'], {'relation': [{'id': 'g-1'}]})
        self.assertEqual(created['properties']['Input'], {'select': {'name': 'Recording'}})
        self.assertNotIn('Overall', created['properties'])  # not reviewed: no AI was used
        self.assertEqual(interviews.saved_transcript(tracker, page['id']), SPOKEN)
        self.assertEqual(interviews.listing(tracker)[0]['application'], ['g-1'])
        # Where the job is comes from the linked Applications row, so a job the app's list lacks still shows it.
        grafana['properties'].update({'Location': text('Zürich, Switzerland'), 'Work mode': {'type': 'select', 'select': {'name': 'On-site'}}})
        self.assertEqual(interviews.listing(tracker)[0]['place'], {'location': 'Zürich, Switzerland', 'work_mode': 'On-site'})
        # The Calendar's read skips the place: one Notion read per linked job made it wait ~20 s.
        reads = []
        real = tracker._request
        tracker._request = lambda method, path, *a, **k: (reads.append(path), real(method, path, *a, **k))[1]
        self.assertEqual(interviews.listing(tracker, places=False)[0]['place'], {})
        self.assertFalse([path for path in reads if path.startswith('pages/')])
        tracker._request = real
        # A job not in Applications yet is added there first (an interview means you applied), then linked.
        added = []

        def add(tracker_, url, **kwargs):
            added.append((url, kwargs['approx']))
            tracker_.apps.append(app('n-1', 'Newco', 'Applied', '2026-09-26') | {'properties': dict(
                app('n-1', 'Newco', 'Applied', '2026-09-26')['properties'], **{'Job URL': {'type': 'url', 'url': url}})})
        with mock.patch('src.notion.ledger.add_application', side_effect=add):
            interviews.save(tracker, SPOKEN, 'Newco call', job_url='https://jobs.test/newco', now=NOW)
        self.assertEqual(added, [('https://jobs.test/newco', True)])
        self.assertEqual(tracker.requests[-1]['properties']['Application'], {'relation': [{'id': 'n-1'}]})
        with mock.patch('src.notion.ledger.add_application'), self.assertRaisesRegex(ValueError, 'Could not add'):
            interviews.save(tracker, SPOKEN, 'x', job_url='https://x.test/nope')

        client = FakeClient()
        log = interviews.run(tracker, page_id=page['id'], client=client, now=NOW)
        self.assertIn('You: We drain nodes', client.calls[0]['messages'][0]['content'])
        self.assertIn('Caption: Grafana, round 1', client.calls[0]['messages'][0]['content'])
        self.assertIn('Grafana Labs', log)
        patched = tracker.pages[page['id']]
        self.assertEqual(patched['properties']['Overall'], {'select': {'name': 'positive'}})
        self.assertEqual(patched['properties']['Application'], {'relation': [{'id': 'g-1'}]})
        kinds = [b['type'] for b in tracker.blocks[page['id']]]
        self.assertEqual(kinds[0], 'paragraph')  # the review took the placeholder's place, above the transcript
        self.assertEqual(kinds[-1], 'heading_3')
        self.assertNotIn(interviews.PLACEHOLDER, str(tracker.blocks[page['id']]))
        self.assertEqual(len(tracker.requests), 2)  # the review added no row (2 = the two saves above)
        # Saving a recorded call moves its job on at once; the review then adds the next step.
        self.assertEqual(tracker.updates[:2], [('g-1', {'Stage': {'select': {'name': 'Interviewing'}}}),
                                               ('n-1', {'Stage': {'select': {'name': 'Interviewing'}}})])
        self.assertEqual(tracker.updates[-1][1]['Next step'], {'rich_text': [{'text': {'content': 'System design next week'}}]})
        self.assertEqual(patched['properties']['Input'], {'select': {'name': 'Recording'}})  # kept, not "Transcript"

    def test_the_row_made_when_the_transcript_was_ready_is_updated_by_save_not_duplicated(self):
        tracker = NotionPages([app('g-1', 'Grafana Labs', 'Applied', '2026-09-20')])
        first = interviews.save(tracker, SPOKEN, 'Interview 28 Sep 10:00', now=NOW)  # right after transcription
        named = SPOKEN.replace('Speaker 1', 'Anna (recruiter)')
        interviews.save(tracker, named, 'Grafana, round 1', job_url='https://x.test/g-1', page_id=first['id'], now=NOW)
        self.assertEqual(len(tracker.pages), 1)
        row = tracker.pages[first['id']]['properties']
        self.assertEqual(row['Interview']['title'][0]['text']['content'], 'Grafana, round 1')
        self.assertEqual(row['Application'], {'relation': [{'id': 'g-1'}]})
        toggles = [b for b in tracker.blocks[first['id']] if b['type'] == 'heading_3']
        self.assertEqual(len(toggles), 1)  # the old transcript was replaced, not kept next to the new one
        self.assertEqual(''.join(c['paragraph']['rich_text'][0]['text']['content'] for c in toggles[0]['children']), named.strip())

    def test_linking_a_saved_interview_to_another_job(self):
        tracker = NotionPages([app('g-1', 'Grafana Labs', 'Applied', '2026-09-20'), app('s-1', 'Acme', 'Saved', '')])
        page = interviews.save(tracker, SPOKEN, 'Call', now=NOW)
        self.assertNotIn('Application', tracker.requests[0]['properties'])
        self.assertEqual(interviews.link(tracker, page['id'], 'https://x.test/s-1'), 's-1')
        self.assertEqual(tracker.updates[-2], (page['id'], {'Application': {'relation': [{'id': 's-1'}]}}))
        self.assertEqual(tracker.updates[-1], ('s-1', {'Stage': {'select': {'name': 'Interviewing'}}}))  # the call was held
        interviews.link(tracker, page['id'])
        self.assertEqual(tracker.updates[-1], (page['id'], {'Application': {'relation': []}}))
        interviews.delete(tracker, page['id'])
        self.assertTrue(tracker.pages[page['id']]['properties'] is not None and tracker.archived == [page['id']])

    @staticmethod
    def first_line(tracker, page_id):
        rich = tracker.blocks[page_id][0]['paragraph']['rich_text']
        return ''.join(t['plain_text'] for t in rich), [t['text'].get('link') for t in rich]

    def test_a_job_line_tops_every_interview_page_and_follows_the_link(self):
        tracker = NotionPages([app('g-1', 'Grafana Labs', 'Applied', '2026-09-20'), app('s-1', 'Acme', 'Saved', '')])
        page = interviews.save(tracker, SPOKEN, 'Call', now=NOW)
        self.assertEqual(self.first_line(tracker, page['id'])[0], '🔗 No job linked yet — link it in the Interviews page of the Job Pilotto app')
        interviews.link(tracker, page['id'], 'https://x.test/g-1')
        text, links = self.first_line(tracker, page['id'])
        self.assertEqual(text, '🔗 Job: Grafana Labs · SRE')
        self.assertEqual(links[1], {'url': 'https://www.notion.so/g1'})
        interviews.link(tracker, page['id'], 'https://x.test/s-1')  # changed: replaced, never duplicated
        interviews.link(tracker, page['id'], 'https://x.test/s-1')  # again: idempotent
        lines = [b for b in tracker.blocks[page['id']] if b['type'] == 'paragraph' and b['paragraph']['rich_text'][0]['plain_text'].startswith('🔗')]
        self.assertEqual(len(lines), 1)
        self.assertEqual(self.first_line(tracker, page['id'])[0], '🔗 Job: Acme · SRE')
        interviews.link(tracker, page['id'])
        self.assertIn('No job linked yet', self.first_line(tracker, page['id'])[0])

    def test_save_review_and_held_write_the_line_first(self):
        tracker = NotionPages([app('g-1', 'Grafana Labs', 'Applied', '2026-09-20')])
        page = interviews.save(tracker, SPOKEN, 'Call', job_url='https://x.test/g-1', now=NOW)
        self.assertEqual(self.first_line(tracker, page['id'])[0], '🔗 Job: Grafana Labs · SRE')
        interviews.run(tracker, page_id=page['id'], client=FakeClient(), now=NOW)
        self.assertEqual(self.first_line(tracker, page['id'])[0], '🔗 Job: Grafana Labs · SRE')
        self.assertEqual(sum(b['paragraph']['rich_text'][0]['plain_text'].startswith('🔗') for b in tracker.blocks[page['id']] if b['type'] == 'paragraph'), 1)
        made = interviews.held(tracker, 'g-1', 'Notes about the call')
        self.assertEqual(self.first_line(tracker, made['id'])[0], '🔗 Job: Grafana Labs · SRE')

    def test_a_reviewed_new_page_starts_with_the_line(self):
        tracker = FakeTracker([app('g-1', 'Grafana Labs', 'Applied', '2026-09-20')])
        interviews.run(tracker, file_id='F1', note='Grafana', token='t', client=FakeClient(), now=NOW, opener=opener_for('call.srt', SRT), job_url='https://x.test/g-1')
        children = tracker.requests[0]['children']
        self.assertEqual(children[0]['paragraph']['rich_text'][0]['text']['content'], '🔗 Job: ')
        self.assertLessEqual(len(children), 100)

    def test_the_title_uses_a_named_employer_else_via_else_the_job_else_the_round(self):
        plain_app = lambda **cols: {'id': 'a', 'properties': {k: text(v) for k, v in cols.items()}}
        self.assertEqual(interviews.interview_title('Grafana Labs', 'Technical 1'), 'Grafana Labs · Technical 1')
        self.assertEqual(interviews.interview_title('', 'Recruiter screen', plain_app(Company='', Via='Huxley', Job='Principal SRE')), 'Huxley · Recruiter screen')
        self.assertEqual(interviews.interview_title('', 'Recruiter screen', plain_app(Company='', Via='', Job='Principal SRE')), 'Principal SRE · Recruiter screen')
        self.assertEqual(interviews.interview_title('', 'Recruiter screen'), 'Recruiter screen')
        self.assertEqual(interviews.interview_title('Acme', 'HM', plain_app(Company='Other')), 'Acme · HM')
        placeholder = '(unnamed finance client via recruiter — Principal SRE posting)'
        self.assertEqual(interviews.named(placeholder), '')
        self.assertEqual(interviews.named('Unknown company'), '')
        self.assertEqual(interviews.named('x' * 61), '')
        self.assertEqual(interviews.named('Grafana Labs'), 'Grafana Labs')
        self.assertEqual(interviews.interview_title(placeholder, 'Recruiter screen', plain_app(Via='Huxley')), 'Huxley · Recruiter screen')

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
        rows = [{'properties': {'Topics': text('Kubernetes; Postgres'), 'Weak topics': text('Postgres'),
                                'Overall': {'type': 'select', 'select': {'name': 'positive'}}}},
                {'properties': {'Topics': text('Postgres'), 'Weak topics': text('Postgres'),
                                'Overall': {'type': 'select', 'select': {'name': 'neutral'}}}}]
        # Distinct ids: without credentials (CI) every database id is '' and the fake would answer with events.
        with mock.patch.object(interviews, 'INTERVIEWS_DATABASE_ID', 'interviews-db'):
            stats = interviews.stats_for_insights(FakeTracker(rows))
        self.assertEqual(stats['topics_asked'], {'Postgres': 2, 'Kubernetes': 1})
        self.assertEqual(stats['topics_answered_weakly'], {'Postgres': 2})
        self.assertEqual(stats['overall'], {'positive': 1, 'neutral': 1, 'negative': 0})


if __name__ == '__main__':
    unittest.main()
