import io
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import daily
from src import store as job_store
from src.ai import kit
from src.notion import client as notion

URL = 'https://job-boards.greenhouse.io/acme/jobs/123'
FORM = {
    'questions': [
        {'label': 'First Name', 'required': True, 'fields': [{'name': 'first_name', 'type': 'input_text'}]},
        {'label': 'Resume/CV', 'required': True, 'fields': [{'name': 'resume', 'type': 'input_file'},
                                                           {'name': 'resume_text', 'type': 'textarea'}]},
        {'label': 'Why Acme?', 'required': True, 'fields': [{'name': 'question_1', 'type': 'textarea'}]},
        {'label': 'Need sponsorship?', 'required': True, 'fields': [
            {'name': 'question_2', 'type': 'multi_value_single_select',
             'values': [{'label': 'Yes', 'value': 1}, {'label': 'No', 'value': 0}]}]},
    ],
    'location_questions': [{'label': 'Latitude', 'required': True, 'fields': [{'name': 'latitude', 'type': 'input_hidden'}]}],
    'compliance': [{'type': 'eeoc', 'questions': [{'label': 'Gender', 'required': False, 'fields': [
        {'name': 'gender', 'type': 'multi_value_single_select', 'values': [{'label': 'Decline to self-identify'}]}]}]}],
}
KIT = {'cover_letter': 'Para one.\n\nPara two.', 'highlights': ['Datadog migration'],
       'check_before_sending': ['Sponsorship answer for the UK'],
       'answers': [{'field': 'question_1', 'question': 'Why Acme?', 'answer': 'Reliability at scale.', 'needs_review': False},
                   {'field': 'question_2', 'question': 'Need sponsorship?', 'answer': 'No sponsorship', 'needs_review': False}]}


def opener(request, timeout=None):
    return io.BytesIO(json.dumps(FORM).encode())


class FakeClient:
    def __init__(self):
        self.requests, self.messages = [], self

    def create(self, **params):
        self.requests.append(params)
        return SimpleNamespace(stop_reason='end_turn', content=[SimpleNamespace(type='text', text=json.dumps(KIT))],
                               usage=SimpleNamespace(input_tokens=1000, output_tokens=500,
                                                     cache_read_input_tokens=0, cache_creation_input_tokens=0))


class FakeTracker:
    def __init__(self):
        self.marked, self.sections = [], []

    def page_text(self, page_id=notion.PROFILE_PAGE_ID):
        return 'Profile text' if page_id == notion.PROFILE_PAGE_ID else 'Answers text'

    def url_stages(self):
        return {}

    def update_page(self, page_id, properties):
        self.updates = getattr(self, 'updates', []) + [(page_id, properties)]

    def query_database(self, database_id, filter_=None):
        return []

    def mark(self, job, stage):
        self.marked.append((job['url'], stage))
        return {'id': 'page-1', 'url': 'https://notion.test/page-1'}, 'created'

    def replace_section(self, page_id, heading, block):
        self.sections.append((page_id, heading, block))


class KitTests(unittest.TestCase):
    def test_reads_greenhouse_questions_without_personal_fields(self):
        questions = kit.form_questions(URL, opener)
        self.assertEqual([q['field'] for q in questions], ['question_1', 'question_2', 'gender', 'country'])
        self.assertEqual(questions[1]['options'], ['Yes', 'No'])
        self.assertEqual(questions[2]['kind'], 'Demographic')
        self.assertEqual(kit.form_questions('https://jobs.lever.co/acme/1', opener), [])

    def test_covers_what_greenhouse_keeps_outside_its_question_list(self):
        # The education section is a flag, Hispanic/Latino comes with Race, and Country is on every new form: the kit
        # drafts them too, so the extension fills them without asking Claude at fill time.
        data = {'questions': [], 'education': 'education_optional',
                'compliance': [{'questions': [{'label': 'Race', 'required': False, 'fields': [{'name': 'race', 'type': 'multi_value_single_select', 'values': []}]}]}]}
        opener_with = lambda request, timeout=20: io.BytesIO(json.dumps(data).encode())
        fields = [q['field'] for q in kit.form_questions(URL, opener_with)]
        self.assertEqual(fields, ['race', 'school--0', 'degree--0', 'discipline--0', 'hispanic_ethnicity', 'country'])
        data['education'] = None
        self.assertNotIn('school--0', [q['field'] for q in kit.form_questions(URL, opener_with)])

    def test_select_answer_outside_options_needs_review(self):
        questions = kit.form_questions(URL, opener)
        drafted, _ = kit.draft(FakeClient(), 'm', {'title': 'SRE', 'company': 'Acme', 'url': URL}, 'p', 'a', questions)
        self.assertFalse(drafted['answers'][0]['needs_review'])
        self.assertTrue(drafted['answers'][1]['needs_review'])

    def test_telegram_messages_fit_and_escape(self):
        long_kit = dict(KIT, answers=[{'field': f'q{i}', 'question': f'Q{i} <x>', 'answer': 'A' * 400,
                                       'needs_review': i % 2 == 0} for i in range(20)])
        messages = kit.telegram_messages({'title': 'SRE', 'company': 'Acme', 'url': URL}, long_kit, [], 'https://n.test')
        self.assertGreater(len(messages), 1)
        self.assertTrue(all(len(m) <= 4096 for m in messages))
        self.assertIn('Q1 &lt;x&gt;', ''.join(messages))
        self.assertIn('<pre>Para one.', messages[0])

    def test_prepare_saves_kit_on_saved_row_and_logs_cost(self):
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                job_store.import_watch_report(db, {'jobs': [
                    {'company': 'Acme', 'id': '1', 'title': 'SRE', 'location': 'Zurich', 'url': URL,
                     'description': 'Kubernetes.'}]})
                tracker, client = FakeTracker(), FakeClient()
                messages, log = daily.prepare_kit(db, notion.job_code(URL), tracker, client, 'claude-sonnet-5', opener)
        self.assertEqual(tracker.marked, [(URL, 'Kit ready')])
        self.assertIn('Kit cost (USD)', tracker.updates[0][1])
        page_id, heading, block = tracker.sections[0]
        self.assertEqual((page_id, heading), ('page-1', kit.KIT_HEADING))
        self.assertTrue(block['heading_2']['is_toggleable'])
        payload = block['heading_2']['children'][-1]['code']['rich_text'][0]['text']['content']
        self.assertEqual(json.loads(payload)['answers'][0]['field'], 'question_1')
        system = client.requests[0]['system'][0]
        self.assertIn('Profile text', system['text'])
        self.assertIn('Answers text', system['text'])
        self.assertIn('field question_2', client.requests[0]['messages'][0]['content'])
        self.assertIn('USD 0.007', log)
        self.assertIn('Application kit', messages[0])

    def test_the_kit_run_links_to_the_job_it_was_for(self):
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                job_store.import_watch_report(db, {'jobs': [
                    {'company': 'Acme', 'id': '1', 'title': 'SRE', 'location': 'Zurich', 'url': URL,
                     'description': 'Kubernetes.'}]})
                run = {'mode': 'prepare'}
                daily.prepare_kit(db, notion.job_code(URL), FakeTracker(), FakeClient(), 'claude-sonnet-5', opener, run=run)
        self.assertEqual(run['application'], 'page-1')  # its ⏱️ Search runs row shows on the job's page (Runs)

    def test_find_job_by_page_url(self):
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                job_store.import_watch_report(db, {'jobs': [
                    {'company': 'Acme', 'id': '1', 'title': 'SRE', 'location': 'Zurich',
                     'url': 'https://boards.greenhouse.io/acme/jobs/123?gh_jid=123', 'description': 'd'}]})
                for ref in (URL, 'https://acme.com/careers?gh_jid=123', notion.job_code(
                        'https://boards.greenhouse.io/acme/jobs/123?gh_jid=123')):
                    self.assertEqual(daily.find_job(db, daily._job_arg(ref))['title'], 'SRE', ref)
                self.assertIsNone(daily.find_job(db, 'https://job-boards.greenhouse.io/acme/jobs/999'))

    def test_unknown_code(self):
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                messages, _ = daily.prepare_kit(db, 'deadbeef', FakeTracker(), FakeClient())
        self.assertIn('No job', messages[0])


class AutoKitTests(unittest.TestCase):
    def test_pending_for_auto_orders_by_score_and_skips_done(self):
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                jobs = [dict(id=i, fit={'score': s}) for i, s in [(1, 80), (2, 55), (3, 40), (4, 90)]]
                pending = kit.pending_for_auto(db, jobs, min_score=50, max_jobs=2)
                self.assertEqual([j['id'] for j in pending], [4, 1])
                kit.mark_auto(db, 4)
                pending2 = kit.pending_for_auto(db, jobs, min_score=50, max_jobs=2)
                self.assertEqual([j['id'] for j in pending2], [1, 2])

    def test_auto_run_drafts_saves_and_records(self):
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                job_store.import_watch_report(db, {'jobs': [
                    {'company': 'Acme', 'id': '1', 'title': 'SRE', 'location': 'Zurich', 'url': URL,
                     'description': 'd'}]})
                jobs = [{'id': 1, 'title': 'SRE', 'company': 'Acme', 'url': URL, 'description': 'd',
                        'fit': {'score': 80}}]
                tracker, client = FakeTracker(), FakeClient()
                summary, drafted = kit.auto_run(db, jobs, tracker, 'claude-sonnet-5', max_jobs=5, min_score=50,
                                                client=client, opener=opener)
                self.assertIn('Auto-drafted 1 of 1', summary)
                self.assertEqual(len(drafted), 1)
                self.assertEqual(tracker.marked, [(URL, 'Kit ready')])
                # A second run must skip the same job (already recorded).
                summary2, drafted2 = kit.auto_run(db, jobs, tracker, 'claude-sonnet-5', max_jobs=5, min_score=50,
                                                  client=client, opener=opener)
                self.assertIn('0 kit(s)', summary2)
                self.assertEqual(drafted2, [])

    def test_auto_run_below_threshold_is_skipped(self):
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                jobs = [{'id': 1, 'title': 'SRE', 'company': 'Acme', 'url': URL, 'fit': {'score': 40}}]
                summary, drafted = kit.auto_run(db, jobs, FakeTracker(), 'm', max_jobs=5, min_score=50,
                                                client=FakeClient())
                self.assertIn('0 kit(s)', summary)
                self.assertEqual(drafted, [])


if __name__ == '__main__':
    unittest.main()


class EligibilityTests(unittest.TestCase):
    def test_the_kit_carries_the_eligibility_verdict_into_next_step_telegram_and_notion(self):
        from src.ai import kit as kit_module
        kit = {'eligible': False, 'eligibility_note': 'UK residents only', 'cover_letter': 'Hi', 'answers': [],
               'highlights': [], 'check_before_sending': []}
        self.assertEqual(kit_module.next_step(kit), '⛔ Not eligible: UK residents only')
        self.assertEqual(kit_module.next_step({**kit, 'eligible': True}), '📝 Kit ready: review it, then Apply')
        job = {'title': 'SRE', 'company': 'Acme', 'url': 'https://x.test/1'}
        self.assertIn('Not eligible', kit_module.telegram_messages(job, kit, [])[0])
        self.assertIn('eligible', kit_module.SCHEMA['required'])
