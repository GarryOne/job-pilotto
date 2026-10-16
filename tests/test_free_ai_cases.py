"""tools/free-ai-cases.py builds the Free AI quality cases from the app's own scoring request: one case per job, the baseline carried, no prompt copied."""
import importlib.util
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location('free_ai_cases', Path(__file__).resolve().parents[1] / 'tools' / 'free-ai-cases.py')
cases_tool = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(cases_tool)


class FreeAiCasesTest(unittest.TestCase):
    def test_one_case_per_job_with_the_scoring_request_and_the_baseline(self):
        jobs = [{'id': 'a1', 'title': 'Data Engineer', 'company': 'Acme', 'location': 'Zurich', 'description': 'Build pipelines.', 'claudeScore': 80},
                {'id': 'b2', 'title': 'Designer', 'company': 'Beta', 'description': 'Design things.'}]
        out = cases_tool.cases(jobs, 'PROFILE TEXT')
        self.assertEqual([c['id'] for c in out], ['a1', 'b2'])
        self.assertEqual([c['baseline'] for c in out], [80, None])
        params = out[0]['params']
        self.assertIn('PROFILE TEXT', params['system'][0]['text'])
        self.assertIn('Data Engineer', params['messages'][0]['content'])
        self.assertIn('[case a1]', params['messages'][0]['content'])
        self.assertEqual(params['output_config']['format']['schema']['required'][0], 'score')


if __name__ == '__main__':
    unittest.main()
