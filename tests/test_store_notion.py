"""The notion store passes the store contract, against the in-memory Notion stand-in (desktop/e2e/lib/notion-fake.mjs).

The stand-in runs in node on a free local port, private to this test: no token, no real workspace, nothing shared.
Each test gets fresh databases, built from config/notion_schema.json, so a column the adapter writes that a
workspace would lack fails here. Skipped where node isn't installed (the stand-in is Node built-ins only).
"""
import inspect
import json
import os
import shutil
import subprocess
import unittest
import urllib.request
from pathlib import Path
from unittest import mock

from src.notion.client import Tracker
from src.stores import base, notion
from tests.store_contract import StoreContract

ROOT = Path(__file__).resolve().parent.parent
FAKE = ROOT / 'desktop' / 'e2e' / 'lib' / 'notion-fake.mjs'
SCHEMA = json.loads((ROOT / 'config' / 'notion_schema.json').read_text())
# Column types the stand-in can't create from a schema entry alone; the store never writes them.
COMPUTED = {'formula', 'rollup', 'last_edited_time', 'created_time', 'unique_id', 'people'}


def _direct(request, timeout=20):
    """urlopen, but not urlopen itself: the Tracker paces only real Notion (src/notion/pace.py)."""
    return urllib.request.urlopen(request, timeout=timeout)


@unittest.skipUnless(shutil.which('node'), 'node runs the Notion stand-in')
class NotionStoreTests(StoreContract, unittest.TestCase):
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

    def _callTestMethod(self, method):
        """A contract test that reaches an entity whose Notion side hasn't landed (src/stores/notion.py PENDING) is skipped."""
        try:
            method()
        except NotImplementedError as missing:
            self.skipTest(str(missing))

    def make(self):
        self.tracker = Tracker('stand-in-token', opener=_direct)
        env = {'NOTION_TOKEN': 'stand-in-token'}
        for variable, spec in SCHEMA['databases'].items():
            columns = {name: {column['type']: {}} for name, column in spec['columns'].items() if column['type'] not in COMPUTED}
            env[variable] = self.tracker._request('POST', 'databases', {
                'parent': {'page_id': 'stand-in-root'}, 'title': [{'text': {'content': spec['title']}}], 'properties': columns})['id']
        for variable in ('NOTION_PROFILE_PAGE_ID', 'NOTION_ANSWERS_PAGE_ID', 'NOTION_KNOWLEDGE_PAGE'):
            env[variable] = self.tracker._request('POST', 'pages', {
                'parent': {'page_id': 'stand-in-root'}, 'properties': {'title': {'title': [{'text': {'content': variable}}]}}})['id']
        self.env = env
        return notion.open_store(env, tracker=self.tracker)

    def test_every_method_takes_the_interfaces_parameter_names(self):
        """The contract's check, on the entities that have landed (the others are placeholders)."""
        if not notion.PENDING:
            return super().test_every_method_takes_the_interfaces_parameter_names()
        for entity in ('applications', 'events', 'matches', 'interviews', 'insights', 'employers', 'agent_runs',
                       'cron_runs', 'texts'):
            if entity in notion.PENDING:
                continue
            protocol = getattr(base, ''.join(part.title() for part in entity.split('_')))
            for name, method in vars(protocol).items():
                if name.startswith('_') or not callable(method):
                    continue
                want = [p for p in inspect.signature(method).parameters if p != 'self']
                have = getattr(getattr(self.s, entity), name)
                self.assertEqual(list(inspect.signature(have).parameters), want, f'{entity}.{name}')

    def test_a_question_on_no_job_is_titled_with_the_emails_subject(self):
        asked = self.s.events.add('', 'Rejected', '2026-10-03', source='Gmail', source_id='m9', needs_you=True,
                                  changes={'fields': {}, 'subject': 'Your application at Acme'})
        page = self.tracker._request('GET', f"pages/{asked['id']}")
        self.assertEqual(page['properties']['Event']['title'][0]['plain_text'], '❓ Which job? · Your application at Acme')
        self.assertTrue(page['properties']['Needs you']['checkbox'])

    def test_put_keeps_a_copied_records_fields_and_dates_under_a_new_id(self):
        if notion.PENDING:
            app = self.s.applications.put({'url': 'https://jobs.example.com/sre-1', 'title': 'SRE', 'stage': 'Applied',
                                           'applied_on': '2026-09-01', 'created_at': '2026-08-30T10:00:00+00:00'})
            self.assertEqual((app['stage'], app['created_at'][:10]), ('Applied', '2026-08-30'))
            self.s.events.put({'app_id': app['id'], 'kind': 'Applied', 'at': '2026-09-01', 'created_at': '2026-09-01T09:00:00+00:00'})
            self.assertEqual(self.s.events.list(app_id=app['id'])[0]['created_at'][:10], '2026-09-01')
            return
        super().test_put_keeps_a_copied_records_fields_and_dates_under_a_new_id()

    def test_a_section_written_before_the_stores_is_read_and_rewritten_in_place(self):
        """Today's pages: a plain heading with its blocks after it, then the next section. Kept as it is."""
        app = self.s.applications.create({'url': 'https://jobs.example.com/sre-1', 'title': 'SRE'}, 'Applied')
        para = lambda text: {'type': 'paragraph', 'paragraph': {'rich_text': [{'type': 'text', 'text': {'content': text}}]}}
        heading = lambda text: {'type': 'heading_2', 'heading_2': {'rich_text': [{'type': 'text', 'text': {'content': text}}]}}
        self.tracker.append_blocks(app['id'], [heading('🎤 Interview prep'), para('Old line'), heading('Notes'), para('Keep me')])
        self.assertEqual(self.s.applications.section(app['id'], '🎤 Interview prep'), 'Old line')
        self.s.applications.set_section(app['id'], '🎤 Interview prep', 'New line')
        self.assertEqual(self.s.applications.sections(app['id']), {'🎤 Interview prep': 'New line', 'Notes': 'Keep me'})
        kinds = [block['type'] for block in self.tracker._children(app['id']) if not block.get('archived')]
        self.assertEqual(kinds, ['heading_2', 'paragraph', 'heading_2', 'paragraph'], 'the page keeps its shape')

    def test_every_application_field_has_its_own_column_in_the_schema(self):
        """A field without a column would be lost on Notion: each maps to a Job Tracker column the schema has."""
        from src.stores import notion_rows
        mapped = {field: column for field, column, _ in notion_rows.APPLICATION_COLUMNS}
        self.assertEqual(set(mapped) | {'id'}, set(base.APPLICATION_FIELDS))
        self.assertEqual(len(set(mapped.values())), len(mapped), 'one column per field')
        have = SCHEMA['databases']['NOTION_APPLICATIONS_DB']['columns']
        self.assertEqual([c for c in mapped.values() if c not in have], [])

    def test_the_frozen_records_fields_are_written_and_read_back(self):
        app = self.s.applications.create({'url': 'https://jobs.example.com/sre-1', 'title': 'SRE'}, 'Applied')
        stamp = {'ats': 'Greenhouse', 'posted': '2026-09-20', 'tier': 'A', 'days_to_apply': 3, 'cover_letter': True,
                 'kit_cost': 0.42, 'cv_version': 'cv.pdf · 1a2b', 'date_approximate': True, 'interview_prep': '2026-10-08T09:00'}
        row = self.s.applications.update(app['id'], stamp)
        self.assertEqual({k: row[k] for k in stamp}, stamp)
        self.assertEqual({k: self.s.applications.get(app['url'] if 'url' in app else row['url'])[k] for k in stamp}, stamp)

    def test_a_text_keeps_the_pages_other_blocks_and_its_table(self):
        """The Profile page also holds ⚙️ Search settings (a child page) and the 📎 CV: rewriting the text keeps them."""
        page = self.env['NOTION_PROFILE_PAGE_ID']
        self.tracker._request('POST', 'pages', {'parent': {'page_id': page}, 'properties': {'title': {'title': [{'text': {'content': 'Search settings'}}]}}})
        profile = '# Experience\n\n| Role | Company |\n| --- | --- |\n| SRE | Acme |\n\nOpen to Zurich.'
        self.s.texts.set('profile', profile)
        self.assertEqual(self.s.texts.get('profile'), profile)
        self.s.texts.set('profile', 'Short now.')
        kinds = [block['type'] for block in self.tracker._children(page) if not block.get('archived')]
        self.assertEqual((self.s.texts.get('profile'), kinds), ('Short now.', ['child_page', 'paragraph']))

    def test_every_agent_run_extra_has_its_column_in_the_schema(self):
        """A `fields` key without a column would be lost on Notion (one copy): each is written to, or computed by, a column."""
        from src.stores import notion_agent_runs as runs
        self.assertEqual(set(runs.EXTRAS) | set(runs.COMPUTED), set(base.AGENT_RUN_EXTRAS))
        have = SCHEMA['databases']['NOTION_AGENT_RUNS_DB']['columns']
        columns = [column for column, _ in runs.EXTRAS.values()] + list(runs.COMPUTED.values())
        self.assertEqual([c for c in columns if c not in have], [])

    def test_an_agent_runs_timeline_and_data_keep_the_specs_shapes(self):
        """Spec §4 "Agent run shapes": timeline is the session's status text; data holds field rows, what was left, files
        and step timings, as JSON in Notion."""
        data = {'fields': [{'label': 'Email', 'required': True, 'source': 'profile', 'outcome': 'filled', 'confidence': 'high', 'reason': ''}],
                'left_for_you': ['Salary'], 'attachments': ['cv.pdf'], 'steps': [{'step': 'open form', 'ms': 1200}, {'step': 'fill', 'ms': 8400}]}
        timeline = 'Started 21:40 · asked you 21:44 · ready 21:47'
        run = self.s.agent_runs.add({'url': 'https://jobs.example.com/sre-1', 'ats': 'Greenhouse', 'learnings': 'Salary is a free field',
                                     'fields': {'data': data, 'timeline': timeline}})
        got = self.s.agent_runs.get(run['id'])
        self.assertEqual((got['fields']['data'], got['fields']['timeline'], got['learnings']), (data, timeline, 'Salary is a free field'))

class NotionRecordsTests(unittest.TestCase):
    """Today's rows, as the engine wrote them before the stores, read as records."""

    def test_an_inbound_rows_title_is_the_role_and_the_interview_time_comes_from_changes(self):
        from src.stores import base, notion_rows
        page = {'id': 'p1', 'created_time': '2026-09-01T08:00:00.000Z', 'properties': {
            'Job': {'type': 'title', 'title': [{'plain_text': 'Principal SRE · via Huxley'}]},
            'Via': {'type': 'rich_text', 'rich_text': [{'plain_text': 'Huxley'}]},
            'Stage': {'type': 'select', 'select': {'name': 'Recruiter lead'}}}}
        app = notion.Applications(None, 'db')._record(page)
        self.assertEqual((app['title'], app['stage'], app['created_at']), ('Principal SRE', 'Recruiter lead', '2026-09-01T08:00:00.000Z'))
        event = notion_rows.to_record({'id': 'e1', 'properties': {
            'Changes': {'type': 'rich_text', 'rich_text': [{'plain_text': '{"fields": {}, "interview_at": "2026-10-08T10:00"}'}]}}},
            notion_rows.EVENT_COLUMNS, base.EVENT_FIELDS)
        self.assertEqual(event['interview_at'], '2026-10-08T10:00')

    def test_what_an_event_moved_and_its_interview_time_share_the_changes_json_as_mail_wrote_it(self):
        from src.stores import notion_rows
        current = {'Changes': {'rich_text': [{'plain_text': '{"fields": {}, "interview_at": "2026-10-08T10:00"}'}]}}
        props = notion_rows.to_properties({'changes': {'fields': {'Stage': ['Applied', 'Screening']}, 'subject': 'Hi'}},
                                          notion_rows.EVENT_COLUMNS, current)
        written = json.loads(''.join(part['text']['content'] for part in props['Changes']['rich_text']))
        self.assertEqual(written, {'fields': {'Stage': ['Applied', 'Screening']}, 'interview_at': '2026-10-08T10:00', 'subject': 'Hi'})
        both = notion_rows.to_properties({'changes': {'fields': {}}, 'interview_at': '2026-10-09T09:00'}, notion_rows.EVENT_COLUMNS)
        self.assertEqual(both['Changes']['rich_text'][0]['text']['content'], '{"fields": {}, "interview_at": "2026-10-09T09:00"}',
                         'an interview event writes the Changes JSON src/notion/ledger.py always wrote')


if __name__ == '__main__':
    unittest.main()
