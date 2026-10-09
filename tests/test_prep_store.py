"""A prep kit and a job description saved through the store (src/ai/prep.py) look on a Notion page as they did before the
store adapters: a plain "🎤 Interview prep" heading with the kit's blocks after it, the replaced kit folded in an "Earlier kit ·
built …" toggle, and a "🧾 Job description" heading with ledger.md_blocks' blocks. On the Notion stand-in
(desktop/e2e/lib/notion-fake.mjs, node; skipped without it). The prep logic itself: tests/test_prep.py.
"""
import json
import shutil
import unittest
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

from src.ai import prep
from src.notion.client import Tracker
from src.notion.ledger import md_blocks
from src.stores import notion as notion_store
from tests.test_prep import KIT, NOW, ROLE, Client
from tests import notion_stand_in

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = json.loads((ROOT / 'config' / 'notion_schema.json').read_text())
COMPUTED = {'formula', 'rollup', 'last_edited_time', 'created_time', 'unique_id', 'people'}


def _direct(request, timeout=20):
    return urllib.request.urlopen(request, timeout=timeout)


def kinds(blocks):
    return [block['type'] for block in blocks]


def text(block):
    return ''.join(run.get('plain_text') or run['text']['content'] for run in block[block['type']].get('rich_text', []))


@unittest.skipUnless(shutil.which('node'), 'node runs the Notion stand-in')
class PrepOnNotionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        notion_stand_in.start(cls)

    @classmethod
    def tearDownClass(cls):
        notion_stand_in.stop(cls)

    def setUp(self):
        self.tracker = Tracker(self.token, opener=_direct)
        env = {'NOTION_TOKEN': self.token}
        for variable, spec in SCHEMA['databases'].items():
            columns = {name: {column['type']: {}} for name, column in spec['columns'].items() if column['type'] not in COMPUTED}
            env[variable] = self.tracker._request('POST', 'databases', {
                'parent': {'page_id': 'stand-in-root'}, 'title': [{'text': {'content': spec['title']}}], 'properties': columns})['id']
        self.stores = notion_store.open_store(env, tracker=self.tracker)
        app = self.stores.applications.create({'url': 'https://jobs.example.com/sre-1', 'title': 'Principal SRE', 'via': 'Huxley'},
                                              'Interview scheduled')
        self.record = self.stores.applications.get(app['url'] if 'url' in app else 'https://jobs.example.com/sre-1')

    def page(self):
        return [b for b in self.tracker._children(self.record['id']) if not b.get('archived')]

    def section(self, title):
        """(heading, the blocks after it until the next heading_2) on the page."""
        top, found = self.page(), None
        for index, block in enumerate(top):
            if block['type'] == 'heading_2' and text(block) == title:
                found = index
                break
        self.assertIsNotNone(found, f'no {title} heading')
        after = []
        for block in top[found + 1:]:
            if block['type'] == 'heading_2':
                break
            after.append(block)
        return top[found], after

    def test_a_description_is_a_plain_heading_with_md_blocks_after_it(self):
        body = '# Role Details\n\n**Position:** Principal SRE\n**Tech Stack:**\n- Deep AWS\n' + ROLE
        prep.describe(self.stores, self.record, text=body)
        heading, after = self.section(prep.DESCRIPTION_HEADING)
        self.assertFalse(heading['heading_2'].get('is_toggleable'))
        self.assertEqual(kinds(after), kinds(md_blocks(body)))

    def test_a_kit_then_a_rebuild_keep_todays_page_shape(self):
        prep.describe(self.stores, self.record, text=ROLE)
        first = datetime(2026, 9, 28, 9, 0, tzinfo=timezone.utc)
        with mock.patch.object(self.stores.texts, 'get', lambda name: 'Igor: 10 years, SRE at Acme'), \
                mock.patch('src.ai.insights_data.interview_stats', lambda stores: {'topics_answered_weakly': {}}):
            self.assertTrue(prep.build(self.stores, self.record, client=Client(), now=first)['ok'])
            heading, after = self.section(prep.HEADING)
            self.assertFalse(heading['heading_2'].get('is_toggleable'))
            self.assertEqual(kinds(after), kinds(prep.blocks(KIT, first, 0.0)))
            self.assertTrue(text(after[0]).startswith('Recruiter screen · built 28 Sep 2026 · $'), text(after[0]))
            self.assertTrue(prep.build(self.stores, self.store_record(), client=Client(), now=NOW)['ok'])
        heading, after = self.section(prep.HEADING)
        toggles = [b for b in after if b['type'] == 'toggle']
        self.assertEqual([text(t) for t in toggles], ['Earlier kit · built 28 Sep 2026'])
        self.assertEqual(kinds(after[:-1]), kinds(prep.blocks(KIT, NOW, 0.0)))   # the new kit, then the folded one
        inside = [b for b in self.tracker._children(toggles[0]['id']) if not b.get('archived')]
        self.assertEqual(kinds(inside), kinds(prep.blocks(KIT, first, 0.0)))
        _, description = self.section(prep.DESCRIPTION_HEADING)
        self.assertTrue(description)  # the job's other sections stay

    def store_record(self):
        return self.stores.applications.get('https://jobs.example.com/sre-1')


if __name__ == '__main__':
    unittest.main()
