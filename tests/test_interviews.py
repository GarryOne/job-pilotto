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
        if method == 'PATCH' and path.startswith('pages/') and body.get('archived'):
            self.archived = getattr(self, 'archived', []) + [path.split('/')[1]]
            return {}
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
        if method == 'PATCH' and path.startswith('blocks/') and not path.endswith('/children'):
            block_id = path.split('/')[1]
            for children in self.blocks.values():
                for b in children:
                    if b.get('id') == block_id:
                        b[b['type']] = self._stored({'type': b['type'], b['type']: body[b['type']]})[b['type']]
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
        self.assertEqual(tracker.updates, [('g-1', {'Stage': {'select': {'name': 'Interviewing'}},
                                                     'Next step': {'rich_text': [{'text': {'content': 'System design next week'}}]}})])
        self.assertIn('Stage → Interviewing', log)
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

    def test_a_screening_review_moves_talks_to_interviewing_and_never_duplicates_the_event(self):
        global RESULT
        original, RESULT = RESULT, dict(RESULT, application=0, round='Recruiter screen (via TechTree)')
        try:
            # Owner's rule (30 Sep 2026): a recruiter screen held stays Screening (Interviewing starts with a
            # technical or hiring-manager round): no Stage change, and no second Screening event.
            tracker = FakeTracker([app('l-1', 'Laelaps AI', 'Screening', '2026-09-23')])
            tracker.events = [{'properties': {'Kind': {'type': 'select', 'select': {'name': 'Screening'}},
                                              'Application': {'type': 'relation', 'relation': [{'id': 'l-1'}]}}}]
            interviews.run(tracker, note='/interview Laelaps screening\n' + 'Notes about the call. ' * 5,
                           client=FakeClient(), now=NOW)
            self.assertNotIn('Stage', tracker.updates[0][1] if tracker.updates else {})
            self.assertEqual(tracker.created, [])  # a Screening event is already logged
            # From an earlier stage, a recruiter screen is Screening.
            tracker = FakeTracker([app('a-1', 'Acme', 'Confirmation received', '2026-09-23')])
            interviews.run(tracker, note='/interview Acme screen\n' + 'Notes about the call. ' * 5,
                           client=FakeClient(), now=NOW)
            self.assertEqual(tracker.updates[0][1]['Stage'], {'select': {'name': 'Screening'}})
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
        # Where the job is comes from the linked Applications row, so a job the app's list lacks still shows it.
        grafana['properties'].update({'Location': text('Zürich, Switzerland'), 'Work mode': {'type': 'select', 'select': {'name': 'On-site'}}})
        self.assertEqual(interviews.listing(tracker)[0]['place'], {'location': 'Zürich, Switzerland', 'work_mode': 'On-site'})
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
        tracker = NotionPages([app('g-1', 'Grafana Labs', 'Applied', '2026-09-20'), app('s-1', 'Sonar', 'Saved', '')])
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
        tracker = NotionPages([app('g-1', 'Grafana Labs', 'Applied', '2026-09-20'), app('s-1', 'Sonar', 'Saved', '')])
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
        self.assertEqual(self.first_line(tracker, page['id'])[0], '🔗 Job: Sonar · SRE')
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

    def test_backfill_adds_the_line_once_and_only_renames_placeholder_titles(self):
        tracker = NotionPages([dict(app('h-1', 'Huxley', 'Applied', '2026-09-20'))])
        tracker.apps[0]['properties']['Company'] = text('')
        tracker.apps[0]['properties']['Via'] = text('Huxley')
        old = interviews.save(tracker, SPOKEN, '(unnamed finance client via recruiter — Principal SRE posting) · Recruiter screen',
                              job_url='https://x.test/h-1', now=NOW)
        good = interviews.save(tracker, SPOKEN, 'Grafana · Technical 1', now=NOW)
        for page in (old, good):  # pages written before this feature: no line
            tracker.blocks[page['id']].pop(0)
        first = interviews.backfill_links(tracker)
        self.assertEqual(first, {'pages': 2, 'linked': 2, 'renamed': 1})
        self.assertEqual(interviews.backfill_links(tracker), {'pages': 2, 'linked': 0, 'renamed': 0})
        self.assertEqual(tracker.pages[old['id']]['properties']['Interview']['title'][0]['text']['content'], 'Huxley · Recruiter screen')
        self.assertEqual(tracker.pages[good['id']]['properties']['Interview']['title'][0]['text']['content'], 'Grafana · Technical 1')
        self.assertEqual(self.first_line(tracker, old['id'])[0], '🔗 Job: Huxley · SRE')
        self.assertIn('No job linked yet', self.first_line(tracker, good['id'])[0])
        self.assertEqual(tracker.blocks[old['id']][1]['type'], 'paragraph')  # the old first block was kept, right after

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
        from src import daily
        argv = ['daily', '--mode', 'interview', '--interview', 'iv-1']
        env = {k: v for k, v in daily.os.environ.items() if k not in ('TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID')}
        with mock.patch.object(sys, 'argv', argv), mock.patch.dict(daily.os.environ, env, clear=True), \
                mock.patch.object(daily.telegram, 'keychain_token', return_value=None), \
                mock.patch.object(daily.notion.Tracker, 'from_env', return_value=FakeTracker([])), \
                mock.patch.object(daily, 'log_ai_run'), \
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


def huxley(stage='Interview scheduled', **props):
    """The owner's case (30 Sep 2026): an agency's call, booked, held and reviewed."""
    row = app('h-1', '', stage, '')
    row['properties'].update({'Via': text('Huxley'), 'Location': text('Remote'),
                              'Next interview': {'type': 'date', 'date': {'start': '2026-09-26T06:30:00.000Z'}}})
    row['properties'].update(props)
    return row


FACTS = [{'field': 'salary', 'value': 'CHF 160-180k/year', 'quote': 'the band is 160 to 180 thousand francs'},
         {'field': 'contract', 'value': 'b2b / contractor', 'quote': 'it would be a B2B contract'},
         {'field': 'location', 'value': 'Hybrid, Zurich 2 days', 'quote': 'two days a week in Zurich'},
         {'field': 'work_mode', 'value': 'Remote', 'quote': 'mostly remote'},
         {'field': 'relocation', 'value': 'Not stated', 'quote': ''},
         {'field': 'team_size', 'value': '8 SREs', 'quote': 'a team of eight SREs'},
         {'field': 'salary_ask', 'value': 'CHF 170k', 'quote': 'I am looking at 170'},
         {'field': 'work_mode', 'value': 'Hybrid', 'quote': 'twice the same field: the first wins'}]


class AdvanceTests(unittest.TestCase):
    def test_a_held_interview_moves_talks_forward_with_its_event_next_step_and_clears_the_past_date(self):
        # A recruiter screen held: Screening (from a booked call or a lead), unchanged at Screening.
        for stage, expected in (('Interview scheduled', 'Screening'), ('Recruiter lead', 'Screening'), ('Screening', None)):
            self.assertEqual(interviews.held_stage(stage, 'Recruiter screen'), expected)
        # A technical or hiring-manager round: Interviewing.
        for stage in ('Interview scheduled', 'Screening', 'Recruiter lead'):
            tracker = FakeTracker([])
            self.assertEqual(interviews.advance(tracker, huxley(stage), now=NOW, round_='Technical interview',
                                                next_step='Hiring manager call next week'), 'Interviewing')
            self.assertEqual(tracker.created[0][1]['Kind'], {'select': {'name': 'Interviewing'}})
            self.assertEqual(tracker.updates, [('h-1', {
                'Stage': {'select': {'name': 'Interviewing'}},
                'Next step': {'rich_text': [{'text': {'content': 'Hiring manager call next week'}}]},
                'Next interview': {'date': None}})])
        # A coming interview stays; "not stated" is no next step.
        tracker = FakeTracker([])
        row = huxley(**{'Next interview': {'type': 'date', 'date': {'start': '2026-10-02T09:00:00Z'}}})
        interviews.advance(tracker, row, now=NOW, next_step='not stated')
        self.assertEqual(tracker.updates, [('h-1', {'Stage': {'select': {'name': 'Interviewing'}}})])

    def test_never_backwards_and_never_a_closed_stage(self):
        tracker = FakeTracker([])
        self.assertIsNone(interviews.advance(tracker, huxley('Interviewing'), now=NOW, next_step='Final round'))
        self.assertNotIn('Stage', tracker.updates[0][1])  # already there: next step and the date only
        for stage in ('Offer', 'Rejected', 'Withdrawn', 'Closed', 'Dismissed'):
            tracker = FakeTracker([])
            self.assertIsNone(interviews.advance(tracker, huxley(stage), now=NOW, next_step='x',
                                                 changes={'Salary': {'rich_text': []}}))
            self.assertEqual((tracker.updates, tracker.created), ([], []), stage)


class FactsTests(unittest.TestCase):
    def test_empty_fields_are_filled_same_values_left_and_different_ones_reported(self):
        row = huxley(**{'Work mode': {'type': 'select', 'select': {'name': 'Remote'}},
                        'Call facts': text('Team size: about 10')})
        merged = interviews.merge_facts(row, {'facts': FACTS})
        self.assertEqual(merged['changes'], {
            'Salary': {'rich_text': [{'text': {'content': 'CHF 160-180k/year'}}]},
            'Contract': {'select': {'name': 'B2B / contractor'}},  # the option's own spelling
            'Call facts': {'rich_text': [{'text': {'content': 'Team size: about 10 · Your ask: CHF 170k'}}]}})
        self.assertEqual([f['label'] for f in merged['filled']], ['Salary', 'Contract', 'Your ask'])
        self.assertEqual([(f['label'], f['current'], f['value']) for f in merged['differs']],
                         [('Location', 'Remote', 'Hybrid, Zurich 2 days'), ('Team size', 'about 10', '8 SREs')])
        self.assertEqual([f['label'] for f in merged['same']], ['Work mode'])
        # Unknown select values and "not stated" are dropped.
        self.assertEqual(interviews.facts_of({'facts': [{'field': 'contract', 'value': 'freelance-ish', 'quote': ''}]}), [])

    def test_the_review_fills_the_job_and_reports_differences_without_overwriting(self):
        global RESULT
        original, RESULT = RESULT, dict(RESULT, application=0, round='Technical interview', facts=FACTS,
                                        next_step='Intro with the hiring manager')
        try:
            tracker, sent = FakeTracker([huxley()]), []
            log = interviews.run(tracker, note='/interview Huxley\n' + 'Notes about the call. ' * 5,
                                 client=FakeClient(), now=NOW, send=sent.append)
        finally:
            RESULT = original
        (page_id, update), = tracker.updates
        self.assertEqual(update['Stage'], {'select': {'name': 'Interviewing'}})
        self.assertEqual(update['Salary'], {'rich_text': [{'text': {'content': 'CHF 160-180k/year'}}]})
        self.assertEqual(update['Next interview'], {'date': None})
        self.assertNotIn('Location', update)  # "Remote" stays: the call said something else, reported instead
        self.assertIn('Huxley, Technical interview', log)
        self.assertIn('Stage → Interviewing; filled Salary (CHF 160-180k/year), Contract (B2B / contractor)', log)
        self.assertIn('differs from the job, not changed: Location (call: Hybrid, Zurich 2 days; job: Remote)', log)
        page = str(tracker.requests[0]['children'])
        self.assertIn('Facts from the call', page)
        self.assertIn('“two days a week in Zurich” ⚠️ The job says “Remote”: not changed', page)
        self.assertIn('Salary: CHF 160-180k/year — “the band is 160 to 180 thousand francs” (added to the job)', page)
        self.assertIn('📋 Added to the job: Salary: CHF 160-180k/year', sent[0])
        self.assertIn('⚠️ Location: the call said “Hybrid, Zurich 2 days”, the job says “Remote” (not changed)', sent[0])
        self.assertIn('facts', interviews.SCHEMA['required'])  # the same single call extracts them


class FocusAnswerTests(unittest.TestCase):
    def test_yes_it_happened_saves_the_notes_as_an_interview_and_moves_the_job_on(self):
        tracker = NotionPages([huxley()])
        notes = 'Talked to Jaya for 30 minutes: salary band 160-180k, B2B possible, next a call with the CTO.'
        out = interviews.held(tracker, 'h-1', notes, now=NOW)
        self.assertEqual((out['ok'], out['stage'], out['review']), (True, 'Interviewing', True))
        row = tracker.pages[out['id']]['properties']
        self.assertEqual(row['Input'], {'select': {'name': 'Notes'}})
        self.assertEqual(row['Date'], {'date': {'start': '2026-09-26'}})  # the day it was held
        self.assertEqual(row['Application'], {'relation': [{'id': 'h-1'}]})
        self.assertEqual(interviews.saved_transcript(tracker, out['id']), notes)  # the review reads the notes
        self.assertEqual(tracker.updates[-1][1]['Stage'], {'select': {'name': 'Interviewing'}})
        self.assertEqual(tracker.created[0][1]['Kind'], {'select': {'name': 'Interviewing'}})
        # Without notes it's still recorded as held, and there's nothing to review.
        self.assertFalse(interviews.held(NotionPages([huxley()]), 'h-1', '', now=NOW)['review'])

    def test_moved_updates_the_next_interview_and_cancelled_logs_it_without_moving_the_stage(self):
        tracker = NotionPages([huxley()])
        interviews.moved(tracker, 'h-1', '2026-10-03T09:00:00+02:00')
        self.assertEqual(tracker.updates, [('h-1', {'Next interview': {'date': {'start': '2026-10-03T09:00:00+02:00'}}})])
        self.assertEqual(tracker.created[0][1]['Kind'], {'select': {'name': 'Interview scheduled'}})
        with self.assertRaises(ValueError):
            interviews.moved(tracker, 'h-1', '')
        tracker = NotionPages([huxley()])
        interviews.cancelled(tracker, 'h-1')
        self.assertEqual(tracker.created[0][1]['Kind'], {'select': {'name': 'Interview cancelled'}})
        self.assertEqual(tracker.updates, [('h-1', {'Next interview': {'date': None}})])  # no Stage

    def test_the_sweep_moves_on_a_recorded_interview_saved_before(self):
        tracker = FakeTracker([huxley(), huxley() | {'id': 'h-2'}])
        tracker.query_database = lambda database_id, filter_=None: (
            [] if database_id == ledger.EVENTS_DATABASE_ID else
            [{'properties': {'Date': {'type': 'date', 'date': {'start': '2026-09-26'}},
                             'Application': {'type': 'relation', 'relation': [{'id': 'h-1'}]}}}]
            if database_id == interviews.INTERVIEWS_DATABASE_ID else tracker.apps)
        with mock.patch.object(interviews, 'INTERVIEWS_DATABASE_ID', 'ivdb'):
            self.assertIn('1 application(s)', interviews.sweep(tracker, now=NOW))
        self.assertEqual(tracker.updates, [('h-1', {'Stage': {'select': {'name': 'Interviewing'}}})])  # h-2: not recorded


if __name__ == '__main__':
    unittest.main()
