"""The kit section contract (src/stores/base.py KIT_SECTION, kit_from): today's kit Markdown, as kit.py writes it, gives
back the machine-readable kit. The extension's reader tests the same sample (tests/fixtures/stores/kit-section.md)."""
import unittest
from pathlib import Path

from src.ai.kit import notion_blocks
from src.stores import base
from src.stores.notion_blocks import to_markdown

SAMPLE = Path(__file__).resolve().parent / 'fixtures' / 'stores' / 'kit-section.md'


class KitSectionTests(unittest.TestCase):
    def test_the_sample_is_what_kit_py_writes_today(self):
        job = {'title': 'Senior SRE', 'company': 'E2E Acme', 'url': 'https://jobs.example.com/sre-1'}
        kit = {'eligible': True, 'check_before_sending': ['Salary range is a guess'], 'highlights': ['Ran Kubernetes at scale'],
               'cover_letter': 'Dear E2E Acme,\n\nI run platforms.',
               'answers': [{'question': 'Notice period?', 'answer': '3 months', 'needs_review': False},
                           {'question': 'Work permit?', 'answer': 'Swiss B permit', 'needs_review': True}]}
        heading = notion_blocks(job, kit, [], 'claude-sonnet-5')
        self.assertEqual(heading['heading_2']['rich_text'][0]['text']['content'], base.KIT_SECTION)
        self.assertEqual(to_markdown(heading['heading_2']['children']) + '\n', SAMPLE.read_text())

    def test_the_machine_kit_is_the_last_json_fence(self):
        kit = base.kit_from(SAMPLE.read_text())
        self.assertEqual((kit['version'], kit['url'], kit['answers'][1]['needs_review']), (1, 'https://jobs.example.com/sre-1', True))
        self.assertIsNone(base.kit_from('No kit here.'))
        self.assertIsNone(base.kit_from('```json\nnot json\n```'))
        self.assertEqual(base.kit_from('```json\n{"a": 1}\n```\n\n```json\n{"a": 2}\n```'), {'a': 2})


if __name__ == '__main__':
    unittest.main()
