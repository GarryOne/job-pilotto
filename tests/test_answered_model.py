"""What a step saves or shows as its model is the model that answered (src/ai/cost.py answered), never the one asked for: an OpenAI engine
maps the Claude tier it is asked for to its own (9 Oct 2026: OpenAI-scored jobs and Insights pages said claude-sonnet-5-5)."""
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import digest
from src import store as job_store
from src.ai import cost, enrich, kit, score

ROOT = Path(__file__).resolve().parents[1]
ANSWERED = 'gpt-6.1-sol'


def usage(model=ANSWERED):
    return SimpleNamespace(input_tokens=100, output_tokens=40, cache_read_input_tokens=0, cache_creation_input_tokens=0, model=model)


class Client:
    """An OpenAI-family engine: asked for a Claude model, answers with its own (usage.model)."""
    def __init__(self, data):
        self.data, self.asked = data, []
        self.messages = self

    def create(self, **params):
        self.asked.append(params['model'])
        return SimpleNamespace(stop_reason='end_turn', content=[SimpleNamespace(type='text', text=json.dumps(self.data))], usage=usage())


def seed(db, count=2):
    job_store.import_watch_report(db, {'jobs': [{'company': 'Example', 'id': str(i), 'title': f'SRE {i}', 'location': 'Zurich',
                                                 'url': f'https://x.test/{i}', 'description': 'Kubernetes, Terraform, Datadog.'} for i in range(count)]})
    db.execute("UPDATE jobs SET last_seen_at = '2099-01-01T00:00:00+00:00'")


FIT = {'score': 80, 'tier': 'A', 'reason': 'Kubernetes match', 'components': {'role_fit': 80, 'location': 80, 'compensation': 50, 'growth': 70, 'risk': 20},
       'strengths': ['Kubernetes'], 'gaps': [], 'confidence': 'medium'}


class AnsweredModelTests(unittest.TestCase):
    def test_the_answering_model_wins_and_a_claude_engine_keeps_the_one_asked(self):
        self.assertEqual(cost.answered('claude-sonnet-5-5', usage()), ANSWERED)
        self.assertEqual(cost.answered('claude-sonnet-5-5', usage('')), 'claude-sonnet-5-5')
        self.assertEqual(cost.answered('claude-sonnet-5-5', SimpleNamespace(input_tokens=1, output_tokens=1)), 'claude-sonnet-5-5')   # the Anthropic SDK's usage has no model

    def test_scores_are_saved_and_summed_up_under_the_model_that_answered(self):
        with tempfile.TemporaryDirectory() as tmp, job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
            seed(db)
            candidates, _ = digest.eligible_jobs(db)
            client = Client(FIT)
            summary = score.run(db, candidates, 'A real Profile: SRE, Kubernetes, Zurich.', 'claude-sonnet-5-5', 10, client=client, first_pass='')
            self.assertEqual(set(client.asked), {'claude-sonnet-5-5'})   # asked by the Claude tier, as the engine maps it
            self.assertEqual({row[0] for row in db.execute('SELECT model FROM scores')}, {ANSWERED})
            self.assertIn(f'with {ANSWERED}', summary)
            self.assertNotIn('claude-sonnet-5-5', summary)

    def test_facts_are_saved_and_summed_up_under_the_model_that_answered(self):
        facts = {'languages': {'required': [], 'plus': []}, 'english_sufficient': True, 'seniority': {'value': 'Senior', 'evidence': ''},
                 'work_mode': {'value': 'Hybrid', 'remote_scope': '', 'evidence': ''}, 'workload': 'unknown', 'salary': {'stated': False, 'text': ''},
                 'employer_type': {'value': 'unknown', 'evidence': ''}, 'role_family': 'sre', 'technologies': [], 'on_call': 'unknown', 'confidence': 'high'}
        with tempfile.TemporaryDirectory() as tmp, job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
            seed(db)
            summary = enrich.run(db, 'claude-haiku-5-5', 10, client=Client(facts), workers=2)
            self.assertEqual({row[0] for row in db.execute('SELECT model FROM enrichments')}, {ANSWERED})
            self.assertIn(f'with {ANSWERED}', summary)

    def test_the_kit_line_names_the_model_that_answered(self):
        self.assertIn(f'Kit drafted with {ANSWERED};', kit.cost_line('claude-sonnet-5-5', usage()))

    def test_every_page_that_names_its_model_in_notion_names_the_answering_one(self):
        # The class (9 Oct 2026): each place that writes a model name a person reads in Notion. A new one goes in this list with its cost.answered.
        writers = {
            'src/ai/insights.py': r"model = cost\.answered\(model, response\.usage\)[\s\S]*'model': model\}[\s\S]*model = cost\.answered\(model, usage\)[\s\S]*record\(insight, now\.date\(\), model, usd\)",
            'src/ai/interviews.py': r"review_fields\(result, app, now\.date\(\), cost\.answered\(model, usage\)",
            'src/ai/interview_insights.py': r"record_of\(stored, items, digest, cost\.answered\(model_, usage\)",
            'src/ai/rejection.py': r"write\(stores, app, result, cost\.answered\(model, usage\)\)",
        }
        for path, pattern in writers.items():
            self.assertRegex((ROOT / path).read_text(), pattern, path)
        # Any other module writing a "Model" property or "Reviewed by" must be added above.
        named = {str(p.relative_to(ROOT)) for p in (ROOT / 'src').rglob('*.py') if re.search(r"'Model': |Reviewed by \{", p.read_text())}
        self.assertLessEqual(named - set(writers), {'src/ai/interviews_blocks.py', 'src/ai/interview_insights.py', 'src/ai/learning.py', 'src/ai/insights.py'},
                             'a new page names its model: pass it cost.answered(model, usage) and list it here')


if __name__ == '__main__':
    unittest.main()
