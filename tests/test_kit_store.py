"""A kit saved through the store (src/ai/kit.py kit_markdown + set_section) shows on a Notion page exactly as before the
store adapters: the same blocks under the same toggle heading. Checked twice: through the codec alone, and end to end on
the Notion stand-in (desktop/e2e/lib/notion-fake.mjs, node; skipped without it). The memory/sqlite side: tests/test_kit.py.
"""
import json
import os
import shutil
import subprocess
import tempfile
import unittest
import urllib.request
from pathlib import Path
from unittest import mock

from src import daily, store as job_store
from src.ai import kit
from src.notion import client as notion
from src.notion.client import Tracker
from src.stores import notion as notion_store
from src.stores.notion_blocks import to_blocks
from tests.test_kit import URL, FakeClient, opener

ROOT = Path(__file__).resolve().parent.parent
FAKE = ROOT / 'desktop' / 'e2e' / 'lib' / 'notion-fake.mjs'
SCHEMA = json.loads((ROOT / 'config' / 'notion_schema.json').read_text())
COMPUTED = {'formula', 'rollup', 'last_edited_time', 'created_time', 'unique_id', 'people'}
JOB = {'title': 'SRE', 'company': 'Acme', 'url': URL}
KIT = {'eligible': True, 'check_before_sending': ['Salary range'], 'highlights': ['On-call **lead**'],
       'cover_letter': 'Dear Acme,\n\nI run platforms.\n\nBest', 'answers': [
           {'field': 'question_1', 'question': 'Why us?', 'answer': 'Because *you* ship.', 'needs_review': False},
           {'field': 'question_2', 'question': 'Visa?', 'answer': 'No', 'needs_review': True}]}


def shape(blocks):
    """What a reader sees of each block: its type, its text, whether any of it is bold, a code block's language."""
    out = []
    for block in blocks:
        body = block[block['type']]
        runs = body.get('rich_text', [])
        out.append((block['type'], ''.join(run.get('plain_text') or run['text']['content'] for run in runs),
                    any((run.get('annotations') or {}).get('bold') for run in runs), body.get('language')))
    return out


class KitMarkdownTests(unittest.TestCase):
    def test_the_kits_markdown_becomes_todays_blocks_again(self):
        today = kit.notion_blocks(JOB, KIT, [{'field': 'question_1'}], 'claude-sonnet-5-5')['heading_2']['children']
        self.assertEqual(shape(to_blocks(kit.kit_markdown(JOB, KIT, [{'field': 'question_1'}], 'claude-sonnet-5-5'))), shape(today))

    def test_the_kit_is_the_sections_last_json_fence(self):
        markdown = kit.kit_markdown(JOB, KIT, [], 'm')
        self.assertTrue(markdown.rstrip().endswith('```'))
        self.assertIn('### Machine-readable kit', markdown)
        fence = markdown.rsplit('```json', 1)[1].split('\n```', 1)[0]
        self.assertEqual(json.loads(fence)['answers'][1]['needs_review'], True)


def _direct(request, timeout=20):
    return urllib.request.urlopen(request, timeout=timeout)


@unittest.skipUnless(shutil.which('node'), 'node runs the Notion stand-in')
class KitOnNotionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        script = f"import {{startNotionFake}} from {json.dumps(FAKE.as_uri())}; const f = await startNotionFake(); console.log(f.url);"
        cls.server = subprocess.Popen(['node', '--input-type=module', '-e', script], stdout=subprocess.PIPE, text=True)
        cls.url = cls.server.stdout.readline().strip()
        if not cls.url.startswith('http'):
            cls.server.kill()
            raise RuntimeError('the Notion stand-in did not start')
        cls.env = mock.patch.dict(os.environ, {'JOB_PILOTTO_E2E': '1', 'JOB_PILOTTO_E2E_NOTION_BASE_URL': cls.url})
        cls.env.start()

    @classmethod
    def tearDownClass(cls):
        cls.env.stop()
        cls.server.kill()
        cls.server.wait()

    def test_a_kit_drafted_through_the_store_is_todays_page(self):
        tracker = Tracker('stand-in-token', opener=_direct)
        env = {'NOTION_TOKEN': 'stand-in-token'}
        for variable, spec in SCHEMA['databases'].items():
            columns = {name: {column['type']: {}} for name, column in spec['columns'].items() if column['type'] not in COMPUTED}
            env[variable] = tracker._request('POST', 'databases', {
                'parent': {'page_id': 'stand-in-root'}, 'title': [{'text': {'content': spec['title']}}], 'properties': columns})['id']
        stores = notion_store.open_store(env, tracker=tracker)
        with tempfile.TemporaryDirectory() as tmp, job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
            job_store.import_watch_report(db, {'jobs': [{'company': 'Acme', 'id': '1', 'title': 'SRE', 'location': 'Zurich',
                                                         'url': URL, 'description': 'Kubernetes.'}]})
            daily.prepare_kit(db, notion.job_code(URL), tracker, FakeClient(), 'claude-sonnet-5-5', opener, stores=stores)
        record = stores.applications.get(URL)
        self.assertEqual(record['stage'], 'Kit ready')
        headings = [b for b in tracker._children(record['id']) if b['type'] == 'heading_2' and not b.get('archived')]
        self.assertEqual([plain(b) for b in headings], [kit.KIT_HEADING])
        self.assertTrue(headings[0]['heading_2'].get('is_toggleable'))
        # Today's blocks for the same kit (its JSON is in the fence) vs what the page now holds under the heading.
        saved = json.loads(stores.applications.section(record['id'], kit.KIT_SECTION).rsplit('```json', 1)[1].split('\n```', 1)[0])
        questions = kit.form_questions(URL, opener)
        today = kit.notion_blocks(JOB, saved, questions, 'claude-sonnet-5-5')['heading_2']['children']
        on_page = [b for b in tracker._children(headings[0]['id']) if not b.get('archived')]
        self.assertEqual(shape(on_page), shape(today))
        self.assertEqual(shape(on_page)[-1][3], 'json')


def plain(block):
    return ''.join(run.get('plain_text') or run['text']['content'] for run in block[block['type']]['rich_text'])


if __name__ == '__main__':
    unittest.main()
