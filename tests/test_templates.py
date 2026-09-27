"""The private-repo workflow templates must keep matching the public engine they call."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENGINE = ROOT / '.github' / 'workflows'
TEMPLATES = ROOT / 'templates' / 'github-actions'


def call_inputs(text):
    """Input names under on.workflow_call.inputs."""
    block = re.search(r'\n  workflow_call:\n    inputs:\n((?:      .*\n)+)', text)
    return set(re.findall(r'^      ([a-z_]+):', block.group(1), re.M)) if block else set()


class TemplateTests(unittest.TestCase):
    def test_each_template_calls_its_engine_with_known_inputs_and_the_repo_secrets(self):
        for template in sorted(TEMPLATES.glob('*.yml')):
            with self.subTest(template.name):
                text = template.read_text()
                self.assertIn(f'uses: GarryOne/job-pilotto/.github/workflows/{template.name}@main', text)
                self.assertIn('secrets: inherit', text)
                self.assertIn('schedule:', text)
                passed = set(re.findall(r'^      ([a-z_]+): ', text.split('    with:\n', 1)[1], re.M))
                self.assertLessEqual(passed, call_inputs((ENGINE / template.name).read_text()))

    def test_the_public_engine_has_no_schedule(self):
        for name in ('daily.yml', 'scout.yml', 'mail.yml'):
            with self.subTest(name):
                text = (ENGINE / name).read_text()
                self.assertNotIn('  schedule:', text)
                self.assertIn('code_repository', call_inputs(text))
