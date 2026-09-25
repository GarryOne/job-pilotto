import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

from src.notion.client import job_code

SCRIPT = Path(__file__).resolve().parents[1] / 'tools' / 'benchmark-apply-runs.py'
SPEC = importlib.util.spec_from_file_location('application_benchmark', SCRIPT)
benchmark = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(benchmark)


class BenchmarkTests(unittest.TestCase):
    def test_coverage_correctness_and_false_claims_across_three_ats(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cases = []
            for ats in ('Greenhouse', 'Ashby', 'Lever'):
                url = f'https://example.test/{ats}'
                code = job_code(url)
                (root / f'{code}.json').write_text(json.dumps(
                    {'url': url, 'status': 'ready', 'minutes': 2.5}))
                (root / f'{code}.result.json').write_text(json.dumps({'fields': [
                    {'label': 'Email', 'matches_source': True},
                    {'label': 'Location', 'matches_source': True},
                ]}))
                cases.append({'url': url, 'ats': ats, 'submitted': False, 'reviewed_fields': [
                    {'label': 'Email', 'correct': True},
                    {'label': 'Location', 'correct': False},
                    {'label': 'Resume', 'correct': True},
                ]})
            result = benchmark.summarize(cases, root)
            self.assertEqual(result['cases'], 3)
            self.assertEqual(result['coverage'], 0.667)
            self.assertEqual(result['correctness'], 0.667)
            self.assertEqual(result['false_agent_claims'], 3)
            self.assertEqual(result['active_minutes'], 7.5)

    def test_rejects_submission_and_insufficient_ats_coverage(self):
        with tempfile.TemporaryDirectory() as directory:
            case = {'url': 'https://example.test/job', 'ats': 'Greenhouse', 'submitted': True,
                    'reviewed_fields': [{'label': 'Email', 'correct': True}]}
            with self.assertRaises(ValueError):
                benchmark.score_case(case, Path(directory))
            with self.assertRaises(ValueError):
                benchmark.summarize([], Path(directory))


if __name__ == '__main__':
    unittest.main()
