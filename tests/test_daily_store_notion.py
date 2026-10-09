"""The daily run's store reads and writes on the Notion stand-in (src/daily_helpers.py): what a Notion user had before the
engine went through the store. The same calls on the memory store: tests/test_applications.py."""
import json
import re
import tempfile
import unittest
import urllib.error
from datetime import date
from pathlib import Path
from unittest import mock

from src import daily
from src import store as job_store
from src.notion import client as notion, ledger
from src.stores.notion import DATABASES
from tests import test_store_notion as stand_in

STAMP = re.compile(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d)?')
SKIP = {'created_time', 'last_edited_time', 'created_by', 'last_edited_by', 'parent', 'public_url', 'request_id'}


def workspace(tracker, env):
    """Every page of every database, with its blocks, as JSON whose ids are the order they were met and whose timestamps
    (to the second) are one placeholder: two runs that wrote the same things give the same text."""
    ids = {}
    def norm(value):
        if isinstance(value, dict):
            return {k: norm(v) for k, v in sorted(value.items()) if k not in SKIP and not (k == 'id' and v not in ids)}
        if isinstance(value, list):
            return [norm(v) for v in value]
        if isinstance(value, str):
            if value in ids:
                return ids[value]
            return STAMP.sub('<time>', value)
        return value
    def blocks(block_id):
        found = [block for block in tracker._children(block_id) if not block.get('archived')]
        return [{**norm(block), 'children': blocks(block['id'])} for block in found]
    out = {}
    for entity, variable in sorted(DATABASES.items()):
        pages = [page for page in tracker.query_database(env[variable]) if not page.get('archived')]
        for page in pages:
            ids.setdefault(page['id'], f'<{entity} {len(ids)}>')
        out[entity] = [{'properties': norm(page['properties']), 'blocks': blocks(page['id'])} for page in pages]
    return json.dumps(out, indent=1, sort_keys=True, ensure_ascii=False)


@unittest.skipUnless(stand_in.shutil.which('node'), 'node runs the Notion stand-in')
class TrackedJobOnNotionTests(unittest.TestCase):
    setUpClass = classmethod(stand_in.NotionStoreTests.setUpClass.__func__)
    tearDownClass = classmethod(stand_in.NotionStoreTests.tearDownClass.__func__)
    make = stand_in.NotionStoreTests.make

    def setUp(self):
        self.s = self.make()
        posting = mock.patch.object(daily.ats, 'posting', return_value=None)
        posting.start()
        self.addCleanup(posting.stop)

    def test_the_job_tracker_row_by_url_and_by_code(self):
        url = 'https://job-boards.greenhouse.io/acme/jobs/42'
        self.s.applications.create({'url': url, 'title': 'Staff SRE', 'company': 'Acme'}, 'Saved')
        job = daily.tracked_job(url, self.s)
        self.assertEqual((job['title'], job['company'], job['url']), ('Staff SRE', 'Acme', url))
        self.assertEqual(daily.tracked_job(notion.job_code(url), self.s)['url'], url)
        self.assertIsNone(daily.tracked_job('https://x.test/untracked', self.s))

    def test_the_job_matches_row_when_there_is_no_tracker_row(self):
        url = 'https://jobs.ashbyhq.com/acme/abc-123'
        self.s.matches.upsert({'url': url, 'title': 'Platform SRE', 'company': 'Acme', 'location': 'Zurich'})
        job = daily.tracked_job(notion.job_code(url), self.s)
        self.assertEqual((job['title'], job['company'], job['location']), ('Platform SRE', 'Acme', 'Zurich'))



AI = {'seniority': {'value': 'senior'}, 'work_mode': {'value': 'hybrid'}, 'english_is_enough': {'value': 'yes'},
      'languages': [{'language': 'German', 'level': 'nice_to_have'}], 'salary': {'stated': True, 'text': 'CHF 140k'},
      'employer_type': {'value': 'direct'}, 'technologies': ['Kubernetes', 'Go'], 'role_family': 'SRE'}
FIT = {'score': 81, 'tier': 'A', 'reason': 'Strong platform match', 'strengths': ['Kubernetes'], 'gaps': ['German'],
       'confidence': 'high', 'components': {'role_fit': 9, 'location': 8, 'compensation': 7, 'growth': 6, 'risk': 2}}
# Accepted D7 differences (mac-e4, 9 Oct 2026): the store fills the settable Created date (applications, events), and an Applied
# event without a time takes the application's own date, where tracker.mark's stale row made it "now" for a row that existed.


def before(db, url, tracker, action):
    """Today's Notion path for a Telegram button, as src/daily_helpers.py apply_message ran it before the store (the reference)."""
    job = daily.find_job(db, url)
    page, outcome = tracker.mark(job, daily.ACTIONS[action])
    if daily.ACTIONS[action] == 'Applied' and outcome != 'unchanged':
        ledger.add_event(tracker, page, 'Applied', 'Telegram')
        ledger.record(tracker, job['url'])
    return outcome


@unittest.skipUnless(stand_in.shutil.which('node'), 'node runs the Notion stand-in')
class TelegramButtonOnNotionTests(unittest.TestCase):
    """A Telegram button (✅ Applied, ⭐, ❌) on Notion writes the pages it wrote through the tracker (D7): the same rows, columns,
    event and frozen record, once as before (the reference) and once through the store, each on a fresh workspace."""
    setUpClass = classmethod(stand_in.NotionStoreTests.setUpClass.__func__)
    tearDownClass = classmethod(stand_in.NotionStoreTests.tearDownClass.__func__)
    make = stand_in.NotionStoreTests.make
    URL = 'https://job-boards.greenhouse.io/acme/jobs/42'

    def setUp(self):
        patch = mock.patch.object(daily.ats, '_board', mock.Mock(side_effect=urllib.error.URLError('offline')))
        patch.start()
        self.addCleanup(patch.stop)

    def press(self, presses, through_store, matched=False):
        s = self.make()
        self.tracker.database_id = self.env['NOTION_APPLICATIONS_DB']
        with mock.patch.object(ledger, 'EVENTS_DATABASE_ID', self.env['NOTION_EVENTS_DB']), \
                mock.patch.object(notion, 'MATCHES_DATABASE_ID', self.env['NOTION_MATCHES_DB']), \
                tempfile.TemporaryDirectory() as tmp, job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
            job_store.import_watch_report(db, {'jobs': [{'company': 'Acme', 'id': '42', 'title': 'Staff SRE', 'location': 'Zurich',
                                                         'url': self.URL}]})
            if matched:   # the search's own sync wrote its 🎯 match, every scoring column
                job = dict(daily.find_job(db, self.URL), fit=FIT, ai=AI)
                s.matches.sync(db, [job], partial=True)
            for action in presses:
                if through_store:
                    daily.apply_message(db, self.URL, s, action)
                else:
                    before(db, self.URL, self.tracker, action)
        return workspace(self.tracker, self.env)

    def assertSame(self, presses, **kwargs):
        def known(text):
            data = json.loads(text)
            for page in data['applications'] + data['events']:
                page['properties']['Created'] = '<known>'
            for event in data['events']:
                event['properties']['At'] = '<known>'
            for app in data['applications']:   # the frozen record: its JSON as data (key order is Notion's property order)
                for heading in app['blocks']:
                    for block in heading['children']:
                        if block['type'] == 'code':
                            record = json.loads(''.join(part['plain_text'] for part in block['code']['rich_text']))
                            (record.get('match') or {}).pop('Last update', None)   # computed: the stand-in has no such column
                            block['code'] = record
            return data
        old, new = known(self.press(presses, False, **kwargs)), known(self.press(presses, True, **kwargs))
        self.assertEqual(new, old)
        self.assertIn('Staff SRE', json.dumps(new))

    def test_applied_on_a_new_job(self):
        self.assertSame(['applied'])

    def test_saved_then_applied_with_a_match(self):
        self.assertSame(['saved', 'applied', 'applied'], matched=True)

    def test_applied_with_a_match(self):
        self.assertSame(['applied'], matched=True)

    def test_dismissed_then_saved(self):
        self.assertSame(['dismissed', 'saved'])


@unittest.skipUnless(stand_in.shutil.which('node'), 'node runs the Notion stand-in')
class AddLinkOnNotionTests(unittest.TestCase):
    """/add <job URL> [date] on Notion: the employer, the Applications row with its event and record, and the run's link to it, as
    ledger.add_application and cron_runs.log_job wrote them through the tracker (D7), once as before and once through the store."""
    setUpClass = classmethod(stand_in.NotionStoreTests.setUpClass.__func__)
    tearDownClass = classmethod(stand_in.NotionStoreTests.tearDownClass.__func__)
    make = stand_in.NotionStoreTests.make
    URL = 'https://job-boards.greenhouse.io/acme-corp/jobs/77'

    def setUp(self):
        patch = mock.patch.object(daily.ats, '_board', mock.Mock(side_effect=urllib.error.URLError('offline')))
        patch.start()
        self.addCleanup(patch.stop)

    def add(self, through_store, meta, matched=False, again=False):
        import contextlib
        import io
        from src import daily_helpers, ledger_store
        from src.notion import cron_runs
        s = self.make()
        self.tracker.database_id = self.env['NOTION_APPLICATIONS_DB']
        out, runs = io.StringIO(), []
        with mock.patch.object(ledger, 'EVENTS_DATABASE_ID', self.env['NOTION_EVENTS_DB']), \
                mock.patch.object(notion, 'MATCHES_DATABASE_ID', self.env['NOTION_MATCHES_DB']), \
                tempfile.TemporaryDirectory() as tmp, job_store.connect(Path(tmp) / 'jobs.sqlite') as db, \
                contextlib.redirect_stdout(out):
            if matched:
                job_store.import_watch_report(db, {'jobs': [{'company': 'Acme', 'id': '77', 'title': 'Staff SRE', 'location': 'Zurich',
                                                             'url': self.URL}]})
                s.matches.sync(db, [dict(daily.find_job(db, self.URL), fit=FIT, ai=AI)], partial=True)
            for _ in range(2 if again else 1):
                given, found, run = dict(meta), {}, {'mode': 'add'}
                if through_store:
                    given['company'] = ledger_store.company_for(s, self.URL, given)
                    line = ledger_store.add_application(s, self.URL, applied=date(2026, 10, 1), approx=False, source='Telegram',
                                                        meta=given, found=found)
                    daily_helpers.log_store_job(s, run, found['row'], found['created'])
                else:
                    given['company'] = ledger.company_for(self.tracker, self.URL, given)
                    line = ledger.add_application(self.tracker, self.URL, applied=date(2026, 10, 1), approx=False, source='Telegram',
                                                  meta=given, found=found)
                    cron_runs.log_job(run, found['row'], found['created'])
                runs.append((line, {k: v for k, v in run.items() if k != 'application'}, bool(run.get('application'))))
        said = re.sub(r'[0-9a-f]{32}|[0-9a-f-]{36}', '<id>', out.getvalue())
        return runs, said, workspace(self.tracker, self.env)

    def assertSame(self, meta, **kwargs):
        def known(result):
            runs, said, text = result
            data = json.loads(text)
            for page in data['applications'] + data['events']:
                page['properties']['Created'] = '<known>'
            for event in data['events']:
                event['properties']['At'] = '<known>'
            for app in data['applications']:
                for heading in app['blocks']:
                    for block in heading['children']:
                        if block['type'] == 'code':
                            record = json.loads(''.join(part['plain_text'] for part in block['code']['rich_text']))
                            (record.get('match') or {}).pop('Last update', None)
                            block['code'] = record
            return runs, said, data
        old, new = known(self.add(False, meta, **kwargs)), known(self.add(True, meta, **kwargs))
        self.assertEqual(new[0], old[0])   # the reply line, the run's subject, its link to the row
        self.assertEqual(new[1], old[1])   # what it printed ("Job logged: {...}")
        self.assertEqual(new[2], old[2])   # every page and block

    def test_a_page_that_names_its_employer(self):
        self.assertSame({'title': 'Staff SRE', 'company': 'Acme', 'description': 'Kubernetes at scale.'})

    def test_no_company_named_the_match_has_it(self):
        self.assertSame({'title': 'Staff SRE'}, matched=True)

    def test_no_company_and_no_match_the_boards_slug(self):
        self.assertSame({'title': 'Staff SRE'})

    def test_added_twice(self):
        self.assertSame({'title': 'Staff SRE', 'company': 'Acme'}, again=True)


if __name__ == '__main__':
    unittest.main()
