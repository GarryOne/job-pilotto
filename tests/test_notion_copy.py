import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'tools'))
import notion_copy as c  # noqa: E402


def rich(text):
    return [{'type': 'text', 'plain_text': text, 'text': {'content': text}, 'annotations': {}}]


class Workspace:
    """An in-memory Notion: databases (property types), rows and page bodies."""

    def __init__(self, databases):
        self.types = databases  # {db id: {property: type}}
        self.rows = {db: [] for db in databases}
        self.bodies, self.archived, self.next = {}, set(), 1

    def add_row(self, db, properties, body=()):
        page = {'id': f'{db}-row{self.next}', 'properties': properties, 'icon': None}
        self.next += 1
        self.rows[db].append(page)
        self.bodies[page['id']] = [{'id': f"{page['id']}-b{i}", 'type': 'paragraph', 'paragraph': {'rich_text': rich(t)},
                                   'has_children': False} for i, t in enumerate(body)]
        return page

    def pages(self, db):
        return [p for p in self.rows[db] if p['id'] not in self.archived]

    def children(self, block_id):
        return list(self.bodies.get(block_id, []))

    def __call__(self, method, path, body=None):
        parts = path.split('/')
        if method == 'GET' and parts[0] == 'databases':
            return {'properties': {n: {'type': t} for n, t in self.types[parts[1]].items()}}
        if method == 'POST' and path == 'pages':
            db = body['parent']['database_id']
            props = {n: {'type': self.types[db][n], **v} for n, v in body['properties'].items()}
            return {'id': self.add_row(db, props)['id']}
        if method == 'PATCH' and parts[0] == 'pages':
            if body.get('archived'):
                self.archived.add(parts[1])
                return {}
            page = next(p for rows in self.rows.values() for p in rows if p['id'] == parts[1])
            db = next(d for d, rows in self.rows.items() if page in rows)
            page['properties'].update({n: {'type': self.types[db][n], **v} for n, v in body['properties'].items()})
            return {}
        if method == 'PATCH' and parts[-1] == 'children':
            made = []
            for child in body['children']:
                made.append({'id': f'{parts[1]}-new{len(self.bodies.get(parts[1], []))}', 'type': child['type'],
                             child['type']: child[child['type']], 'has_children': False})
                self.bodies.setdefault(parts[1], []).append(made[-1])
            return {'results': made}
        if method == 'DELETE':
            for blocks in self.bodies.values():
                blocks[:] = [b for b in blocks if b['id'] != parts[1]]
            return {}
        raise AssertionError(f'{method} {path}')


APPS = {'Job': 'title', 'Stage': 'select', 'Applied on': 'date', 'Salary': 'number', 'Days since applied': 'formula',
        'Owner': 'people', 'Events': 'relation'}
EVENTS = {'Event': 'title', 'Kind': 'select', 'Application': 'relation'}


class NotionCopyTests(unittest.TestCase):
    def test_source_databases_come_from_the_env_file(self):
        with tempfile.NamedTemporaryFile('w', suffix='.env', delete=False) as env:
            env.write('NOTION_TOKEN=secret\nNOTION_APPLICATIONS_DB=f56b-6894\nNOTION_PROFILE_PAGE_ID="3e56"\nOTHER=x\n')
        self.assertEqual(c.ids_from_env_file(env.name), {'NOTION_APPLICATIONS_DB': 'f56b6894', 'NOTION_PROFILE_PAGE_ID': '3e56'})

    def test_target_databases_come_from_the_desktop_apps_settings(self):
        with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as settings:
            json.dump({'setupDone': True, 'notionIds': {'NOTION_APPLICATIONS_DB': '3e96-2be8', 'NOTION_MATCHES_DB': ''}}, settings)
        self.assertEqual(c.ids_from_env_file(settings.name), {'NOTION_APPLICATIONS_DB': '3e962be8'})

    def test_every_field_is_copied_except_the_ones_notion_computes(self):
        self.assertEqual(c.value({'type': 'select', 'select': {'name': 'Applied', 'color': 'blue', 'id': 'x'}}, 'select'),
                         {'select': {'name': 'Applied'}})
        self.assertEqual(c.value({'type': 'date', 'date': {'start': '2026-09-24', 'end': None}}, 'date'),
                         {'date': {'start': '2026-09-24'}})
        self.assertIsNone(c.value({'type': 'formula', 'formula': {'number': 4}}, 'formula'))
        self.assertIsNone(c.value({'type': 'people', 'people': [{'id': 'u'}]}, 'people'))
        self.assertIsNone(c.value({'type': 'rich_text', 'rich_text': []}, 'select'))  # column changed type: skipped
        files = {'type': 'files', 'files': [{'type': 'external', 'name': 'cv', 'external': {'url': 'https://x/cv.pdf'}},
                                            {'type': 'file', 'name': 'up', 'file': {'url': 'https://s3/expiring'}}]}
        self.assertEqual(len(c.value(files, 'files')['files']), 1)

    def test_rows_bodies_and_links_are_copied_once_and_updated_on_a_second_run(self):
        src = Workspace({'apps': APPS, 'events': EVENTS})
        app = src.add_row('apps', {'Job': {'type': 'title', 'title': rich('SRE at Grafana')},
                                   'Stage': {'type': 'select', 'select': {'name': 'Rejected'}},
                                   'Applied on': {'type': 'date', 'date': {'start': '2026-09-24', 'end': None}},
                                   'Salary': {'type': 'number', 'number': 130000},
                                   'Days since applied': {'type': 'formula', 'formula': {'number': 4}},
                                   'Owner': {'type': 'people', 'people': []}, 'Events': {'type': 'relation', 'relation': []}},
                           body=['Cover letter: …'])
        event = src.add_row('events', {'Event': {'type': 'title', 'title': rich('Rejected · Grafana')},
                                       'Kind': {'type': 'select', 'select': {'name': 'Rejected'}},
                                       'Application': {'type': 'relation', 'relation': [{'id': app['id']}]}})
        app['properties']['Events']['relation'] = [{'id': event['id']}]
        dst = Workspace({'apps2': APPS, 'events2': EVENTS})
        test_row = dst.add_row('apps2', {'Job': {'type': 'title', 'title': rich('dummy')}})
        ids = ({'NOTION_APPLICATIONS_DB': 'apps', 'NOTION_EVENTS_DB': 'events'},
               {'NOTION_APPLICATIONS_DB': 'apps2', 'NOTION_EVENTS_DB': 'events2'})
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp) / 'map.json'
            report = c.copy(src, dst, *ids, state, replace=True, log=lambda *_: None)
            self.assertEqual(report['NOTION_APPLICATIONS_DB copied'], 1)
            self.assertIn(test_row['id'], dst.archived)  # the target's own rows went to the trash
            [copied] = dst.pages('apps2')
            self.assertEqual(copied['properties']['Stage']['select'], {'name': 'Rejected'})
            self.assertNotIn('Days since applied', copied['properties'])
            self.assertEqual(dst.bodies[copied['id']][0]['paragraph']['rich_text'][0]['text']['content'], 'Cover letter: …')
            [copied_event] = dst.pages('events2')
            self.assertEqual(copied['properties']['Events']['relation'], [{'id': copied_event['id']}])  # link kept
            # Second run: nothing duplicated, fields updated.
            app['properties']['Stage']['select'] = {'name': 'Offer'}
            report = c.copy(src, dst, *ids, state, replace=True, log=lambda *_: None)
            self.assertEqual(report['NOTION_APPLICATIONS_DB updated'], 1)
            self.assertEqual(len(dst.pages('apps2')), 1)
            self.assertEqual(dst.pages('apps2')[0]['properties']['Stage']['select'], {'name': 'Offer'})
            self.assertEqual(len(json.loads(state.read_text())), 2)


class RenamedTitleTests(unittest.TestCase):
    """The Applications database was renamed "Job Tracker"; workspaces made before still say "Applications — Job Tracker"."""

    def test_find_ids_knows_the_old_and_the_new_title(self):
        for title in ('💠 Applications — Job Tracker', 'Job Tracker'):
            item = {'object': 'database', 'id': 'ab-cd', 'title': [{'plain_text': title}], 'last_edited_time': '2026-09-30'}
            notion = lambda method, path, body=None, item=item: {'results': [item] if body['filter']['value'] == 'database' else [],
                                                                  'has_more': False}
            self.assertEqual(c.find_ids(notion).get('NOTION_APPLICATIONS_DB'), 'abcd', title)

    def test_a_snapshot_keeps_the_hand_written_keys(self):
        import notion_schema
        fresh = {'databases': {'APPS': {'title': 'Job Tracker', 'columns': {}}, 'RUNS': {'title': 'Runs', 'columns': {}}}}
        before = {'databases': {'APPS': {'former_titles': ['Applications — Job Tracker']}, 'RUNS': {'retired': ['Kits']}}}
        kept = notion_schema.keep_hand_keys(fresh, before)
        self.assertEqual(kept['databases']['APPS']['former_titles'], ['Applications — Job Tracker'])
        self.assertEqual(kept['databases']['RUNS']['retired'], ['Kits'])
        self.assertEqual(notion_schema.problems(notion_schema.load(), json.loads(notion_schema.TEMPLATE.read_text())), [])


if __name__ == '__main__':
    unittest.main()


class RetryTests(unittest.TestCase):
    """8 Oct 2026: the first live-test mirror stopped 44 rows in on one read timeout; a slow reply is retried like a 429."""

    def test_a_timeout_is_retried_and_the_copy_goes_on(self):
        from unittest import mock
        calls = []

        class Reply:
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def read(self): return b'{"ok": true}'

        def urlopen(request, timeout):
            calls.append(request.full_url)
            if len(calls) == 1:
                raise TimeoutError('The read operation timed out')
            return Reply()

        notion = c.Notion('token')
        with mock.patch.object(c.urllib.request, 'urlopen', urlopen), mock.patch.object(c.time, 'sleep', lambda s: None):
            self.assertEqual(notion('GET', 'users/me'), {'ok': True})
        self.assertEqual(len(calls), 2)

    def test_a_connection_that_never_answers_still_fails_in_the_end(self):
        from unittest import mock

        def urlopen(request, timeout):
            raise TimeoutError('The read operation timed out')

        notion = c.Notion('token')
        with mock.patch.object(c.urllib.request, 'urlopen', urlopen), mock.patch.object(c.time, 'sleep', lambda s: None):
            self.assertRaises(TimeoutError, notion, 'GET', 'users/me')
