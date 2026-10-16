"""tools/free-ai-extract-cases.py builds the Free AI extraction cases from the app's own extraction request (src/ai/enrich.py) over the invented postings, each with the facts its text states."""
import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('free_ai_extract_cases', ROOT / 'tools' / 'free-ai-extract-cases.py')
tool = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(tool)


class FreeAiExtractCasesTest(unittest.TestCase):
    def setUp(self):
        self.jobs = json.loads((ROOT / 'tools' / 'free-ai-eval-jobs.json').read_text())
        self.out = tool.cases(self.jobs)

    def test_each_case_is_the_apps_extraction_request_over_an_invented_posting(self):
        self.assertGreaterEqual(len(self.out), 15)
        by_id = {job['id']: job for job in self.jobs}
        for case in self.out:
            params = case['params']
            self.assertIn('You extract facts from job postings', params['system'])
            self.assertIn(by_id[case['id']]['description'], params['messages'][0]['content'])
            self.assertEqual(params['output_config']['format']['schema']['required'][0], 'languages')

    def test_every_expectation_names_a_schema_field_and_an_allowed_value(self):
        from src.ai import enrich
        props = enrich.SCHEMA['properties']
        for case in self.out:
            for path, allowed in case['expect'].get('paths', {}).items():
                node = props[path.split('.')[0]]
                leaf = node['properties'][path.split('.')[1]]
                if 'enum' in leaf:
                    self.assertTrue(set(allowed) <= set(leaf['enum']), f'{case["id"]} {path}')
            for lst, parts in case['expect'].get('has', {}).items():
                item = props[lst]['items']['properties']
                for part in parts:
                    for key, value in part.items():
                        self.assertIn(value, item[key]['enum'], f'{case["id"]} {lst}.{key}')


if __name__ == '__main__':
    unittest.main()
