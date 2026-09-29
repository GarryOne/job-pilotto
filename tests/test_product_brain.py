"""Product brain plumbing (tools/product_brain.py): the lens of the day, Markdown to Notion blocks, and a posted
brief (a Notion row + a Telegram card whose buttons carry the page id). Claude decides; the script only records."""
import datetime as dt
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / 'tools' / 'product_brain.py'
SPEC = importlib.util.spec_from_file_location('product_brain', SCRIPT)
brain = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(brain)


class LensTest(unittest.TestCase):
    def test_weekdays_rotate_and_the_weekend_picks_by_evidence(self):
        monday = dt.date(2026, 9, 28)
        self.assertEqual([brain.lens_of_the_day(monday + dt.timedelta(days=i)) for i in range(5)],
                         ['Growth', 'Product', 'Quality', 'UX', 'Business'])
        self.assertIn('evidence', brain.lens_of_the_day(dt.date(2026, 10, 3)))


class BlocksTest(unittest.TestCase):
    def test_headings_lists_todos_and_paragraphs(self):
        kinds = [b['type'] for b in brain.blocks('## Options\n- one\n1. first\n- [ ] do it\n- [x] done\n\nPlain text')]
        self.assertEqual(kinds, ['heading_2', 'bulleted_list_item', 'numbered_list_item', 'to_do', 'to_do', 'paragraph'])

    def test_long_lines_fit_notion(self):
        self.assertLessEqual(len(brain.blocks('x' * 5000)[0]['paragraph']['rich_text'][0]['text']['content']), 2000)


class PostTest(unittest.TestCase):
    def test_a_brief_becomes_a_proposed_row_and_a_card_with_three_buttons(self):
        calls, sent = [], []
        brain.DATABASE = 'db'
        brain.notion = lambda path, method='GET', body=None: (calls.append((path, method, body)),
                                                               {'id': 'abcd-ef', 'url': 'https://notion.so/x'})[1]
        brain.telegram = lambda text, buttons=None: sent.append((text, buttons))
        with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as file:
            json.dump({'action': 'Post a 3-part LinkedIn launch series', 'lens': 'Growth', 'why': '0 visits from LinkedIn',
                       'effort': '2h', 'expected': '+20 visits', 'check_in_days': 7, 'details': '## Evidence\n- 3 downloads'}, file)
        brain.post(file.name, dt.date(2026, 9, 30))
        created = calls[0][2]['properties']
        self.assertEqual(created['Status']['select']['name'], 'Proposed')
        self.assertEqual(created['Lens']['select']['name'], 'Growth')
        self.assertEqual(created['Check on']['date']['start'], '2026-10-07')
        text, buttons = sent[0]
        self.assertIn('Post a 3-part LinkedIn launch series', text)
        self.assertEqual([b['callback_data'] for b in buttons[0]], ['pb:x:abcdef', 'pb:n:abcdef', 'pb:a:abcdef'])

    def test_unknown_lens_falls_back_and_missing_action_stops(self):
        with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as file:
            json.dump({'lens': 'Growth'}, file)
        with self.assertRaises(SystemExit):
            brain.post(file.name, dt.date(2026, 9, 30))


class StatusTest(unittest.TestCase):
    def test_only_known_statuses(self):
        with self.assertRaises(SystemExit):
            brain.status('abc', 'Shipped')


if __name__ == '__main__':
    unittest.main()
