import io
import json
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import interviews
from src.notion import ledger

NOW = datetime(2026, 9, 26, 15, 0, tzinfo=timezone.utc)
SRT = """1
00:00:01,000 --> 00:00:04,000
<v Interviewer>How do you handle a Kubernetes upgrade?

2
00:00:04,500 --> 00:00:09,000
We drain nodes one pool at a time and watch error budgets.

3
00:00:09,500 --> 00:00:12,000
We drain nodes one pool at a time and watch error budgets.
"""
SPOKEN = ('[00:00:01] Speaker 1: How do you handle a Kubernetes upgrade?\n'
          '[00:00:04] You: We drain nodes one pool at a time and watch error budgets.')
RESULT = {'application': 1, 'company': 'Grafana Labs', 'round': 'Technical 1', 'interviewers': ['SRE manager'],
          'duration_min': 45, 'questions': [
              {'topic': 'Kubernetes upgrades', 'question': 'How do you upgrade?', 'answer': 'Drain pools', 'quality': 'strong', 'better': ''},
              {'topic': 'Postgres replication', 'question': 'Explain failover', 'answer': 'Vague', 'quality': 'weak',
               'better': 'Mention Patroni and your RTO numbers'}],
          'strengths': ['Clear upgrade process'], 'weaknesses': ['Database depth'], 'signals': ['Team of 6'],
          'red_flags': [], 'next_step': 'System design next week', 'practice': ['Postgres HA'], 'overall': 'positive',
          'summary': 'Went well overall.'}


def text(value):
    return {'type': 'rich_text', 'rich_text': [{'plain_text': value}]}


def app(page_id, company, stage, applied):
    return {'id': page_id, 'properties': {'Company': text(company), 'Job': {'type': 'title', 'title': [{'plain_text': 'SRE'}]},
                                          'Stage': {'type': 'select', 'select': {'name': stage}},
                                          'Applied on': {'type': 'date', 'date': {'start': applied}},
                                          'Job URL': {'type': 'url', 'url': f'https://x.test/{page_id}'}}}


class FakeTracker:
    database_id = 'apps'

    def __init__(self, apps):
        self.apps, self.requests, self.updates, self.created = apps, [], [], []

    def query_database(self, database_id, filter_=None):
        if database_id == ledger.EVENTS_DATABASE_ID:
            return getattr(self, 'events', [])
        return self.apps

    def page_text(self):
        return 'SRE at Sonar; Kubernetes, AWS.'

    def _request(self, method, path, body):
        self.requests.append(body)
        return {'id': 'interview-1', 'url': 'https://notion.test/interview-1'}

    def create_page(self, database_id, properties):
        self.created.append((database_id, properties))
        return {'id': 'event'}

    def update_page(self, page_id, properties):
        self.updates.append((page_id, properties))


def rich(value):
    return [{'type': 'text', 'plain_text': value, 'text': {'content': value}}]


class NotionPages(FakeTracker):
    """Pages and blocks kept in memory, answering the Notion calls save/review make."""

    def __init__(self, apps):
        super().__init__(apps)
        self.pages, self.blocks, self.count = {}, {}, 0

    @staticmethod
    def _stored(block):  # what Notion returns: plain_text on every rich text
        kind = block['type']
        body = dict(block[kind], rich_text=[{**t, 'plain_text': t['text']['content']} for t in block[kind]['rich_text']])
        return {'type': kind, kind: body, 'children': body.pop('children', [])}

    def query_database(self, database_id, filter_=None):
        if database_id == interviews.INTERVIEWS_DATABASE_ID:
            return [dict(page, properties={k: {**v, 'type': next(iter(v))} | ({'title': rich(v['title'][0]['text']['content'])}
                                                                               if 'title' in v else {}) for k, v in page['properties'].items()})
                    for page in self.pages.values()]
        if filter_ and filter_.get('property') == 'Job URL':
            return [a for a in self.apps if a['properties']['Job URL']['url'] == filter_['url']['equals']]
        return super().query_database(database_id, filter_)

    def _request(self, method, path, body=None):
        if method == 'POST' and path == 'pages':
            self.requests.append(body)
            self.count += 1
            page_id = f'iv-{self.count}'
            self.pages[page_id] = {'id': page_id, 'url': f'https://notion.test/{page_id}', 'properties': dict(body['properties'])}
            self.blocks[page_id] = []
            for i, block in enumerate(body.get('children', [])):
                stored = self._stored(block)
                stored['id'] = f'{page_id}-b{i}'
                self.blocks[stored['id']] = [dict(self._stored(c), id=f'{stored["id"]}-c{j}') for j, c in enumerate(stored.pop('children'))]
                self.blocks[page_id].append(stored)
            return self.pages[page_id]
        if method == 'GET' and path.startswith('pages/'):
            page_id = path.split('/')[1]
            if page_id in self.pages:
                props = self.pages[page_id]['properties']
                return {'id': page_id, 'properties': {k: dict(v, type=next(iter(v))) | ({'title': rich(v['title'][0]['text']['content'])}
                                                                                       if 'title' in v else {}) for k, v in props.items()}}
            return next(a for a in self.apps if a['id'] == page_id)
        if method == 'PATCH' and path.startswith('pages/'):
            page = self.pages[path.split('/')[1]]
            page['properties'].update(body['properties'])
            return page
        if method == 'PATCH' and path.endswith('/children'):
            page_id = path.split('/')[1]
            new = [dict(self._stored(b), id=f'new-{i}') for i, b in enumerate(body['children'])]
            at = next(i for i, b in enumerate(self.blocks[page_id]) if b['id'] == body['after']) + 1 if 'after' in body else None
            self.blocks[page_id][at:at] = new if at is not None else []
            if at is None:
                self.blocks[page_id] += new
            return {}
        if method == 'DELETE' and path.startswith('blocks/'):
            block_id = path.split('/')[1]
            for children in self.blocks.values():
                children[:] = [b for b in children if b.get('id') != block_id]
            return {}
        raise AssertionError(f'unexpected {method} {path}')

    def _children(self, block_id):
        return self.blocks.get(block_id, [])

    def update_page(self, page_id, properties):
        self.updates.append((page_id, properties))
        if page_id in self.pages:
            self.pages[page_id]['properties'].update(properties)


class FakeClient:
    def __init__(self):
        self.calls, self.messages = [], self

    def create(self, **params):
        self.calls.append(params)
        return SimpleNamespace(stop_reason='end_turn', content=[SimpleNamespace(type='text', text=json.dumps(RESULT))],
                               usage=SimpleNamespace(input_tokens=15000, output_tokens=2000,
                                                     cache_read_input_tokens=0, cache_creation_input_tokens=0))


def opener_for(name, body):
    def opener(url, timeout=None):
        if 'getFile' in url:
            return io.BytesIO(json.dumps({'ok': True, 'result': {'file_path': f'documents/{name}'}}).encode())
        return io.BytesIO(body.encode())
    return opener


class InterviewTests(unittest.TestCase):
    def test_subtitles_are_cleaned(self):
        cleaned = interviews.clean(SRT)
        self.assertEqual(cleaned.splitlines(), ['How do you handle a Kubernetes upgrade?',
                                                'We drain nodes one pool at a time and watch error budgets.'])
        self.assertEqual(interviews.clean('plain notes\n'), 'plain notes')

    def test_file_is_analysed_linked_logged_and_sent(self):
        apps = [app('a-new', 'Anthropic', 'Applied', '2026-09-25'), app('g-1', 'Grafana Labs', 'Applied', '2026-09-20'),
                app('o-1', 'Acme', 'Offer', '2026-09-01')]
        tracker, client, sent, stats = FakeTracker(apps), FakeClient(), [], {}
        log = interviews.run(tracker, file_id='F1', note='Grafana, round 1', token='t', send=sent.append,
                             client=client, now=NOW, opener=opener_for('call.srt', SRT), stats=stats)
        self.assertIn('Grafana Labs, Technical 1, 2 questions', log)
        prompt = client.calls[0]['messages'][0]['content']
        self.assertIn('1. Grafana Labs — SRE (stage Applied', prompt)
        self.assertIn('Caption: Grafana, round 1', prompt)
        self.assertNotIn('-->', prompt)
        body = tracker.requests[0]
        props = body['properties']
        self.assertEqual(props['Application'], {'relation': [{'id': 'g-1'}]})
        self.assertEqual(props['Weak topics']['rich_text'][0]['text']['content'], 'Postgres replication')
        self.assertEqual((props['Questions']['number'], props['Weak answers']['number']), (2, 1))
        self.assertEqual(props['Input'], {'select': {'name': 'Transcript'}})
        self.assertAlmostEqual(props['Cost (USD)']['number'], 0.05)  # 15k in x $2 + 2k out x $10
        self.assertLessEqual(len(body['children']), 100)
        self.assertEqual(tracker.created[0][0], ledger.EVENTS_DATABASE_ID)
        self.assertEqual(tracker.created[0][1]['Kind'], {'select': {'name': 'Interviewing'}})
        self.assertEqual(tracker.updates, [('g-1', {'Stage': {'select': {'name': 'Interviewing'}}})])
        self.assertIn('⚠️ <b>Weak answers (1 of 2)</b>', sent[0])
        self.assertIn('Mention Patroni', sent[0])
        self.assertEqual(stats['tokens_in'], 15000)

    def test_a_local_transcript_file_from_the_desktop_app(self):
        import tempfile
        apps = [app('a-new', 'Anthropic', 'Applied', '2026-09-25'), app('g-1', 'Grafana Labs', 'Applied', '2026-09-20'),
                app('o-1', 'Acme', 'Offer', '2026-09-01')]
        tracker, client = FakeTracker(apps), FakeClient()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'grafana round 1.srt'
            path.write_text(SRT, encoding='utf-8')
            log = interviews.run(tracker, file_id=str(path), note='Grafana, round 1', client=client, now=NOW,
                                 opener=lambda *a, **k: self.fail('a local file must not be downloaded'))
            self.assertIn('Grafana Labs', log)
            self.assertNotIn('-->', client.calls[0]['messages'][0]['content'])
            audio = Path(tmp) / 'call.m4a'
            audio.write_bytes(b'x' * 100)
            with mock.patch.object(interviews.transcribe, 'available', return_value=False):
                with self.assertRaisesRegex(ValueError, 'transcription add-on'):
                    interviews.run(FakeTracker([]), file_id=str(audio), client=FakeClient(), now=NOW)
            # With the add-on, the recording on the Mac is transcribed there (with speakers) and analysed.
            tracker, client = FakeTracker(apps), FakeClient()
            with mock.patch.object(interviews.transcribe, 'available', return_value=True), \
                    mock.patch.object(interviews.transcribe, 'transcribe', return_value=SPOKEN) as run_asr:
                log = interviews.run(tracker, file_id=str(audio), note='Grafana, round 1', client=client, now=NOW)
            self.assertEqual(run_asr.call_args[0][0], audio)
            self.assertIn('You: We drain nodes', client.calls[0]['messages'][0]['content'])
            self.assertEqual(tracker.requests[0]['properties']['Input'], {'select': {'name': 'Recording'}})
            self.assertTrue(log.endswith('https://notion.test/interview-1'))

    def test_a_telegram_voice_note_is_transcribed_from_a_temporary_file(self):
        seen = []

        def fake(path, speakers=0):
            seen.append((path.name, path.read_bytes()))
            return SPOKEN
        with mock.patch.object(interviews.transcribe, 'available', return_value=True), \
                mock.patch.object(interviews.transcribe, 'transcribe', side_effect=fake):
            tracker, client = FakeTracker([app('g-1', 'Grafana Labs', 'Applied', '2026-09-20')]), FakeClient()
            interviews.run(tracker, file_id='F', token='t', opener=opener_for('voice/file_7.oga', 'OggS...'),
                           client=client, now=NOW)
        self.assertEqual(seen, [('file_7.oga', b'OggS...')])
        self.assertIn('Speaker 1: How do you handle', client.calls[0]['messages'][0]['content'])

    def test_the_chosen_job_wins_over_the_guess(self):
        apps = [app('a-new', 'Anthropic', 'Applied', '2026-09-25'), app('g-1', 'Grafana Labs', 'Applied', '2026-09-20')]
        tracker = FakeTracker(apps)  # RESULT guesses index 1 (Grafana); the owner picked Anthropic
        interviews.run(tracker, note='/interview round 1\n' + 'Notes about the call. ' * 5, client=FakeClient(),
                       now=NOW, job_url='https://x.test/a-new')
        self.assertEqual(tracker.requests[0]['properties']['Application'], {'relation': [{'id': 'a-new'}]})
        # A job at a stage the candidate list leaves out (e.g. Saved) is looked up by its URL.
        saved = app('s-1', 'Sonar', 'Saved', '')
        tracker = FakeTracker([])
        tracker.query_database = lambda database_id, filter_=None: (
            [] if database_id == ledger.EVENTS_DATABASE_ID else [saved] if filter_ and filter_.get('property') == 'Job URL' else [])
        interviews.run(tracker, note='/interview Sonar\n' + 'Notes about the call. ' * 5, client=FakeClient(),
                       now=NOW, job_url='https://x.test/s-1')
        self.assertEqual(tracker.requests[0]['properties']['Application'], {'relation': [{'id': 's-1'}]})

    def test_later_stage_is_not_moved_back_and_unknown_application_is_unlinked(self):
        tracker = FakeTracker([app('o-1', 'Acme', 'Offer', '2026-09-01')])
        global RESULT
        original, RESULT = RESULT, dict(RESULT, application=0)
        try:
            interviews.run(tracker, note='/interview Acme final\n' + 'They asked about on-call. ' * 5,
                           client=FakeClient(), now=NOW)
        finally:
            RESULT = original
        self.assertEqual(tracker.updates, [])  # Offer stays Offer
        self.assertEqual(tracker.requests[0]['properties']['Input'], {'select': {'name': 'Notes'}})
        tracker = FakeTracker([])
        sent = []
        interviews.run(tracker, note='/interview Mystery Co\n' + 'Long notes about the call. ' * 5,
                       client=FakeClient(), now=NOW, send=sent.append)
        self.assertNotIn('Application', tracker.requests[0]['properties'])
        self.assertIn('not linked to an application', sent[0])
        self.assertEqual(tracker.created, [])

    def test_a_screening_review_never_jumps_to_interviewing_or_duplicates_the_event(self):
        global RESULT
        original, RESULT = RESULT, dict(RESULT, application=0, round='Recruiter screen (via TechTree)')
        try:
            tracker = FakeTracker([app('l-1', 'Laelaps AI', 'Screening', '2026-09-23')])
            tracker.events = [{'properties': {'Kind': {'type': 'select', 'select': {'name': 'Screening'}},
                                              'Application': {'type': 'relation', 'relation': [{'id': 'l-1'}]}}}]
            interviews.run(tracker, note='/interview Laelaps screening\n' + 'Notes about the call. ' * 5,
                           client=FakeClient(), now=NOW)
            self.assertEqual((tracker.updates, tracker.created), ([], []))  # already at Screening, already logged
            tracker = FakeTracker([app('a-1', 'Acme', 'Confirmation received', '2026-09-23')])
            interviews.run(tracker, note='/interview Acme screen\n' + 'Notes about the call. ' * 5,
                           client=FakeClient(), now=NOW)
            self.assertEqual(tracker.updates, [('a-1', {'Stage': {'select': {'name': 'Screening'}}})])
            self.assertEqual(tracker.created[0][1]['Kind'], {'select': {'name': 'Screening'}})
        finally:
            RESULT = original

    def test_refuses_other_files_and_empty_notes(self):
        with self.assertRaisesRegex(ValueError, 'recording'):
            interviews.run(FakeTracker([]), file_id='F', token='t', opener=opener_for('slides.pdf', 'x' * 100),
                           client=FakeClient())
        with self.assertRaises(ValueError):
            interviews.run(FakeTracker([]), note='/interview Grafana', client=FakeClient())

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
        with self.assertRaisesRegex(ValueError, 'No application'):
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
        self.assertEqual(len(tracker.requests), 1)  # no second row
        self.assertEqual(tracker.updates, [('g-1', {'Stage': {'select': {'name': 'Interviewing'}}})])

    def test_linking_a_saved_interview_to_another_job(self):
        tracker = NotionPages([app('g-1', 'Grafana Labs', 'Applied', '2026-09-20'), app('s-1', 'Sonar', 'Saved', '')])
        page = interviews.save(tracker, SPOKEN, 'Call', now=NOW)
        self.assertNotIn('Application', tracker.requests[0]['properties'])
        self.assertEqual(interviews.link(tracker, page['id'], 'https://x.test/s-1'), 's-1')
        self.assertEqual(tracker.updates[-1], (page['id'], {'Application': {'relation': [{'id': 's-1'}]}}))
        interviews.link(tracker, page['id'])
        self.assertEqual(tracker.updates[-1], (page['id'], {'Application': {'relation': []}}))

    def test_stats_for_insights(self):
        rows = [{'properties': {'Topics': text('Kubernetes; Postgres'), 'Weak topics': text('Postgres'),
                                'Overall': {'type': 'select', 'select': {'name': 'positive'}}}},
                {'properties': {'Topics': text('Postgres'), 'Weak topics': text('Postgres'),
                                'Overall': {'type': 'select', 'select': {'name': 'neutral'}}}}]
        stats = interviews.stats_for_insights(FakeTracker(rows))
        self.assertEqual(stats['topics_asked'], {'Postgres': 2, 'Kubernetes': 1})
        self.assertEqual(stats['topics_answered_weakly'], {'Postgres': 2})
        self.assertEqual(stats['overall'], {'positive': 1, 'neutral': 1, 'negative': 0})


if __name__ == '__main__':
    unittest.main()
