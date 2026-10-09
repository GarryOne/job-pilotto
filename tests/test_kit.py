import io
import json
from src.stores import base
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


def memory_stores():
    """The store a kit is saved in (src/stores memory adapter: the same contract as sqlite and notion), with the texts the AI reads."""
    from src.stores import memory
    stores = memory.open_store()
    stores.texts.set('profile', 'Profile text')
    stores.texts.set('answers', 'Answers text')
    return stores


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
                stores, client = memory_stores(), FakeClient()
                drafted = []
                messages, log = daily.prepare_kit(db, notion.job_code(URL), stores, client, 'claude-sonnet-5-5', opener,
                                                  drafted_out=drafted)
        self.assertEqual([job['title'] for job, _ in drafted], ['SRE'])  # the app's card for the run
        self.assertIn('Drafted for this job', daily.kits_message(drafted, 'Drafted for this job · nothing sent'))
        record = stores.applications.get(URL)
        self.assertEqual(record['stage'], 'Kit ready')
        self.assertGreater(record['kit_cost'], 0)
        self.assertTrue(record['kit_inputs'])
        self.assertEqual(record['next_step'], '📝 Kit ready: review it, then Apply')
        section = stores.applications.section(record['id'], kit.KIT_SECTION)
        self.assertIn('### ✉️ Cover letter', section)
        self.assertEqual(base.kit_from(section)['answers'][0]['field'], 'question_1')
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
                run, stores = {'mode': 'prepare'}, memory_stores()
                daily.prepare_kit(db, notion.job_code(URL), stores, FakeClient(), 'claude-sonnet-5-5', opener, run=run)
        self.assertEqual(run['application'], stores.applications.get(URL)['id'])  # its run row shows on the job's page (Runs)
        self.assertEqual(run['subject'], 'Acme — SRE')

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
                messages, _ = daily.prepare_kit(db, 'deadbeef', memory_stores(), FakeClient())
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
                stores, client = memory_stores(), FakeClient()
                summary, drafted = kit.auto_run(db, jobs, stores, 'claude-sonnet-5-5', max_jobs=5, min_score=50,
                                                client=client, opener=opener)
                self.assertIn('Auto-drafted 1 of 1', summary)
                self.assertEqual(len(drafted), 1)
                self.assertEqual(stores.applications.get(URL)['stage'], 'Kit ready')
                # A second run must skip the same job (already recorded).
                summary2, drafted2 = kit.auto_run(db, jobs, stores, 'claude-sonnet-5-5', max_jobs=5, min_score=50,
                                                  client=client, opener=opener)
                self.assertIn('0 kit(s)', summary2)
                self.assertEqual(drafted2, [])

    def test_auto_run_below_threshold_is_skipped(self):
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                jobs = [{'id': 1, 'title': 'SRE', 'company': 'Acme', 'url': URL, 'fit': {'score': 40}}]
                summary, drafted = kit.auto_run(db, jobs, memory_stores(), 'm', max_jobs=5, min_score=50,
                                                client=FakeClient())
                self.assertIn('0 kit(s)', summary)
                self.assertEqual(drafted, [])


class EffortTests(unittest.TestCase):
    """Haiku 4.5 rejects the `effort` setting with a 400; the end-to-end journey runs every step on it."""

    def effort_for(self, model):
        client = FakeClient()
        kit.draft(client, model, {'title': 'SRE', 'company': 'Acme', 'url': URL}, 'p', 'a', [])
        return client.requests[0]['output_config'].get('effort')

    def test_haiku_gets_no_effort_and_other_models_keep_medium(self):
        self.assertIsNone(self.effort_for('claude-haiku-4-5'))
        self.assertEqual(self.effort_for('claude-sonnet-5-5'), 'medium')


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


class KitLanguageTest(unittest.TestCase):
    """8 Oct 2026: the cover letter was forced into English, even for a French posting."""

    def test_writes_in_the_postings_language(self):
        self.assertIn("in the posting's language", kit.SYSTEM)
        self.assertIn('when the profile shows the candidate speaks it', kit.SYSTEM)   # an English speaker in Zurich keeps English letters
        self.assertNotIn('English, plain', kit.SYSTEM)

    def test_candidate_is_not_assumed_to_be_a_man(self):
        for word in (' he works', ' excites him'):
            self.assertNotIn(word, kit.SYSTEM)


if __name__ == '__main__':
    unittest.main()
