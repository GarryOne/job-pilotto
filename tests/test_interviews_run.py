"""Interview analysis end to end: subtitles, local files, recordings, the chosen job, stages on a review, refused input.
Guards src/ai/interviews.py, interviews_ai.py, interviews_input.py, interviews_stages.py.
"""
import unittest

from tests.interviews_fixtures import *  # noqa: F401,F403 — the shared fakes and fixtures
from tests.interviews_fixtures import setUpModule  # noqa: F401 (the model's answer)
import tests.interviews_fixtures as fixtures  # the fake model reads RESULT from there


class InterviewTests(unittest.TestCase):
    def test_subtitles_are_cleaned(self):
        cleaned = interviews.clean(SRT)
        self.assertEqual(cleaned.splitlines(), ['How do you handle a Kubernetes upgrade?',
                                                'We drain nodes one pool at a time and watch error budgets.'])
        self.assertEqual(interviews.clean('plain notes\n'), 'plain notes')

    def test_file_is_analysed_linked_logged_and_sent(self):
        stores = store_with(job('a-new', 'Anthropic', 'Applied', '2026-09-25'), job('g-1', 'Grafana Labs', 'Applied', '2026-09-20'),
                            job('o-1', 'Acme', 'Offer', '2026-09-01'))
        client, sent, stats = FakeClient(), [], {}
        log = interviews.run(stores=stores, file_id='F1', note='Grafana, round 1', token='t', send=sent.append,
                             client=client, now=NOW, opener=opener_for('call.srt', SRT), stats=stats)
        self.assertIn('Grafana Labs, Technical 1, 2 questions', log)
        prompt = client.calls[0]['messages'][0]['content']
        self.assertIn('1. Grafana Labs — SRE (stage Applied', prompt)
        self.assertIn('Caption: Grafana, round 1', prompt)
        self.assertNotIn('-->', prompt)
        row = only_interview(stores)
        self.assertEqual(row['app_id'], app_id(stores, 'g-1'))
        self.assertEqual((row['weak_topics'], row['questions'], row['weak_answers'], row['input']),
                         ('Postgres replication', 2, 1, 'Transcript'))
        self.assertAlmostEqual(row['cost'], 0.10)  # Opus: 15k in x $4 + 2k out x $20
        self.assertLessEqual(len(notion_blocks.to_blocks(row['review'])), 100)
        self.assertIn('How do you handle a Kubernetes upgrade?', row['transcript'])
        self.assertEqual([e['kind'] for e in stores.events.list()], ['Interviewing'])
        grafana = stores.applications.get('https://x.test/g-1')
        self.assertEqual((grafana['stage'], grafana['next_step']), ('Interviewing', 'System design next week'))
        self.assertIn('Stage → Interviewing', log)
        self.assertIn('<b>Weak answers (1 of 2)</b>', sent[0])
        self.assertIn('Mention Patroni', sent[0])
        self.assertEqual(stats['tokens_in'], 15000)

    def test_a_local_transcript_file_from_the_desktop_app(self):
        import tempfile
        apps = (job('a-new', 'Anthropic', 'Applied', '2026-09-25'), job('g-1', 'Grafana Labs', 'Applied', '2026-09-20'),
                job('o-1', 'Acme', 'Offer', '2026-09-01'))
        stores, client = store_with(*apps), FakeClient()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'grafana round 1.srt'
            path.write_text(SRT, encoding='utf-8')
            log = interviews.run(stores=stores, file_id=str(path), note='Grafana, round 1', client=client, now=NOW,
                                 opener=lambda *a, **k: self.fail('a local file must not be downloaded'))
            self.assertIn('Grafana Labs', log)
            self.assertNotIn('-->', client.calls[0]['messages'][0]['content'])
            audio = Path(tmp) / 'call.m4a'
            audio.write_bytes(b'x' * 100)
            with mock.patch.object(interviews.transcribe, 'available', return_value=False):
                with self.assertRaisesRegex(ValueError, 'transcription add-on'):
                    interviews.run(stores=store_with(), file_id=str(audio), client=FakeClient(), now=NOW)
            # With the add-on, the recording on the Mac is transcribed there (with speakers) and analysed.
            stores, client = store_with(*apps), FakeClient()
            with mock.patch.object(interviews.transcribe, 'available', return_value=True), \
                    mock.patch.object(interviews.transcribe, 'transcribe', return_value=SPOKEN) as run_asr:
                log = interviews.run(stores=stores, file_id=str(audio), note='Grafana, round 1', client=client, now=NOW)
            self.assertEqual(run_asr.call_args[0][0], audio)
            self.assertIn('You: We drain nodes', client.calls[0]['messages'][0]['content'])
            self.assertEqual(only_interview(stores)['input'], 'Recording')
            self.assertTrue(log.endswith('$0.100). Stage → Interviewing'), log)  # a store without links: no link at the end

    def test_a_telegram_voice_note_is_transcribed_from_a_temporary_file(self):
        seen = []

        def fake(path, speakers=0):
            seen.append((path.name, path.read_bytes()))
            return SPOKEN
        with mock.patch.object(interviews.transcribe, 'available', return_value=True), \
                mock.patch.object(interviews.transcribe, 'transcribe', side_effect=fake):
            client = FakeClient()
            interviews.run(stores=store_with(job('g-1', 'Grafana Labs', 'Applied', '2026-09-20')), file_id='F', token='t',
                           opener=opener_for('voice/file_7.oga', 'OggS...'), client=client, now=NOW)
        self.assertEqual(seen, [('file_7.oga', b'OggS...')])
        self.assertIn('Speaker 1: How do you handle', client.calls[0]['messages'][0]['content'])

    def test_the_chosen_job_wins_over_the_guess(self):
        stores = store_with(job('a-new', 'Anthropic', 'Applied', '2026-09-25'), job('g-1', 'Grafana Labs', 'Applied', '2026-09-20'))
        # RESULT guesses index 1 (Grafana); the owner picked Anthropic
        interviews.run(stores=stores, note='/interview round 1\n' + 'Notes about the call. ' * 5, client=FakeClient(),
                       now=NOW, job_url='https://x.test/a-new')
        self.assertEqual(only_interview(stores)['app_id'], app_id(stores, 'a-new'))
        # A job at a stage the candidate list leaves out (e.g. Saved) is looked up by its URL.
        stores = store_with(job('s-1', 'Acme', 'Saved', ''))
        interviews.run(stores=stores, note='/interview Acme\n' + 'Notes about the call. ' * 5, client=FakeClient(),
                       now=NOW, job_url='https://x.test/s-1')
        self.assertEqual(only_interview(stores)['app_id'], app_id(stores, 's-1'))

    def test_a_job_the_interview_names_that_is_not_tracked_is_added(self):
        stores = store_with()
        interviews.run(stores=stores, note='/interview Acme\n' + 'Notes about the call. ' * 5, client=FakeClient(),
                       now=NOW, job_url='https://x.test/new-1')
        added = stores.applications.get('https://x.test/new-1')
        self.assertEqual((added['stage'] in ('Applied', 'Interviewing'), added['date_approximate']), (True, True))
        self.assertEqual(only_interview(stores)['app_id'], added['id'])
        self.assertIn('Applied', [e['kind'] for e in stores.events.list()])

    def test_the_review_run_learns_the_job_the_interview_is_linked_to(self):
        stores = store_with(job('a-new', 'Anthropic', 'Applied', '2026-09-25'), job('g-1', 'Grafana Labs', 'Applied', '2026-09-20'))
        found = {}
        interviews.run(stores=stores, note='/interview round 1\n' + 'Notes about the call. ' * 5, client=FakeClient(),
                       now=NOW, job_url='https://x.test/a-new', found=found)
        self.assertEqual(found['application'], app_id(stores, 'a-new'))
        self.assertEqual(found['title'], 'Grafana Labs · Technical 1')  # the interview's title names the run too
        found = {}  # an interview linked to no job: the run links to none
        interviews.run(stores=store_with(), note='/interview Mystery Co\n' + 'Long notes about the call. ' * 5,
                       client=FakeClient(), now=NOW, found=found)
        self.assertNotIn('application', found)

    def test_later_stage_is_not_moved_back_and_unknown_application_is_unlinked(self):
        stores = store_with(job('o-1', 'Acme', 'Offer', '2026-09-01'))
        before = only_app(stores)
        original, fixtures.RESULT = fixtures.RESULT, dict(fixtures.RESULT, application=0)
        try:
            interviews.run(stores=stores, note='/interview Acme final\n' + 'They asked about on-call. ' * 5,
                           client=FakeClient(), now=NOW)
        finally:
            fixtures.RESULT = original
        self.assertEqual(only_app(stores), before)  # Offer stays Offer
        self.assertEqual(only_interview(stores)['input'], 'Notes')
        stores, sent = store_with(), []
        interviews.run(stores=stores, note='/interview Mystery Co\n' + 'Long notes about the call. ' * 5,
                       client=FakeClient(), now=NOW, send=sent.append)
        self.assertEqual(only_interview(stores)['app_id'], '')
        self.assertIn('not linked to an application', sent[0])
        self.assertEqual(stores.events.list(), [])

    def test_a_screening_review_moves_talks_to_interviewing_and_never_duplicates_the_event(self):
        original, fixtures.RESULT = fixtures.RESULT, dict(fixtures.RESULT, application=0, round='Recruiter screen (via TechTree)')
        try:
            # Owner's rule (30 Sep 2026): a recruiter screen held stays Screening (Interviewing starts with a
            # technical or hiring-manager round): no Stage change, and no second Screening event.
            stores = store_with(job('l-1', 'Zephyr AI', 'Screening', '2026-09-23'))
            stores.events.add(app_id(stores, 'l-1'), 'Screening', '2026-09-24')
            interviews.run(stores=stores, note='/interview Zephyr screening\n' + 'Notes about the call. ' * 5,
                           client=FakeClient(), now=NOW)
            self.assertEqual(only_app(stores)['stage'], 'Screening')
            self.assertEqual(len(stores.events.list()), 1)  # a Screening event is already logged
            # From an earlier stage, a recruiter screen is Screening.
            stores = store_with(job('a-1', 'Acme', 'Confirmation received', '2026-09-23'))
            interviews.run(stores=stores, note='/interview Acme screen\n' + 'Notes about the call. ' * 5,
                           client=FakeClient(), now=NOW)
            self.assertEqual(only_app(stores)['stage'], 'Screening')
            self.assertEqual([e['kind'] for e in stores.events.list()], ['Screening'])
        finally:
            fixtures.RESULT = original

    def test_refuses_other_files_and_empty_notes(self):
        with self.assertRaisesRegex(ValueError, 'recording'):
            interviews.run(stores=store_with(), file_id='F', token='t', opener=opener_for('slides.pdf', 'x' * 100),
                           client=FakeClient())
        with self.assertRaises(ValueError):
            interviews.run(stores=store_with(), note='/interview Grafana', client=FakeClient())


if __name__ == '__main__':
    unittest.main()
