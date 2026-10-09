"""The Jobs list on a store that is not Notion (src/desktop_store_jobs.py): Tracker.notion_jobs()'s shape from the store's matches
and applications, and src/desktop.py using it only when such a store is chosen."""
import io
import json
import unittest
from contextlib import redirect_stdout
from unittest import mock

from src import desktop
from src.desktop_store_jobs import store_jobs
from src.notion import client
from src.stores import memory


def notion_page(url, kind):
    rt = lambda value: {'rich_text': [{'plain_text': value}]}
    if kind == 'match':
        props = {'Job URL': {'url': url}, 'Job': {'title': [{'plain_text': 'SRE'}]}, 'Company': rt('Acme'), 'Score': {'number': 81},
                 'Status': {'select': {'name': 'Open'}}}
    else:
        props = {'Job URL': {'url': url}, 'Job': {'title': [{'plain_text': 'SRE'}]}, 'Company': rt('Acme'), 'Stage': {'select': {'name': 'Applied'}},
                 'Applied on': {'date': {'start': '2026-10-08'}}}
    return {'id': f'{kind}-1', 'url': f'https://notion.so/{kind}', 'created_time': '2026-10-01T00:00:00Z', 'properties': props}


class StoreJobsTests(unittest.TestCase):
    def stores(self):
        stores = memory.open_store()
        stores.matches.upsert({'url': 'https://jobs.test/a', 'title': 'SRE', 'company': 'Acme', 'fit': 81, 'reason': 'good',
                               'status': 'Open', 'first_seen': '2026-10-01', 'fit_detail': {'strengths': 's', 'gaps': 'g', 'parts': {'role_fit': 9}}})
        stores.matches.upsert({'url': 'https://jobs.test/b/', 'title': 'Platform', 'company': 'Beta', 'fit': 55, 'status': 'Open'})
        stores.applications.set_stage({'url': 'https://jobs.test/b', 'title': 'Platform', 'company': 'Beta'}, 'Applied', '2026-10-08')
        stores.applications.set_stage({'url': 'https://jobs.test/lead', 'title': 'Staff SRE', 'company': 'Gamma', 'fit': 70}, 'Recruiter lead')
        return stores

    def test_a_scored_match_and_an_application_appear_with_their_fit_and_stage(self):
        rows = {row['url']: row for row in store_jobs(self.stores())}
        self.assertEqual((rows['https://jobs.test/a']['fit'], rows['https://jobs.test/a'].get('stage')), (81, None))
        self.assertEqual(rows['https://jobs.test/a']['fit_detail']['parts'], {'role_fit': 9})
        merged = rows['https://jobs.test/b/']   # one row per job, whatever URL form each side keeps
        self.assertEqual((merged['fit'], merged['stage'], merged['applied_on'], merged['match_status']), (55, 'Applied', '2026-10-08', 'Open'))
        self.assertEqual((rows['https://jobs.test/lead']['stage'], rows['https://jobs.test/lead']['fit']), ('Recruiter lead', 70))
        self.assertEqual(len(rows), 3)

    def test_an_empty_score_is_none_not_a_weak_match(self):
        stores = memory.open_store()
        stores.applications.set_stage({'url': 'https://jobs.test/e', 'title': 'SRE', 'company': 'Acme', 'fit': ''}, 'Saved')
        self.assertIsNone(store_jobs(stores)[0]['fit'])   # SQLite keeps an unscored fit as '': the app would show "Weak match"

    def test_the_same_keys_as_notion_jobs(self):
        tracker = object.__new__(client.Tracker)
        pages = {None: [notion_page('https://jobs.test/a', 'match')], 'apps': [notion_page('https://jobs.test/b', 'app')]}
        with mock.patch.object(client, 'MATCHES_DATABASE_ID', 'matches-db'), \
                mock.patch.object(client.Tracker, '_query', lambda self, *args: pages[None] if args and args[1] == 'matches-db' else pages['apps'], create=True):
            from_notion = {row['url']: set(row) for row in tracker.notion_jobs()}
        from_store = {row['url']: set(row) for row in store_jobs(self.stores())}
        self.assertEqual(from_store['https://jobs.test/a'], from_notion['https://jobs.test/a'], 'a match alone')
        self.assertEqual(from_store['https://jobs.test/lead'], from_notion['https://jobs.test/b'], 'an application alone')

    def test_desktop_jobs_reads_the_chosen_store_and_never_without_one(self):
        stores = self.stores()
        def listed(env):
            out = io.StringIO()
            with mock.patch.dict('os.environ', env, clear=False), mock.patch.object(client.Tracker, 'from_env', return_value=None), \
                    mock.patch('src.stores.open_stores', return_value=stores), \
                    mock.patch.object(desktop, 'jobs', side_effect=lambda db, limit, notion_jobs=None, **kw: {'jobs': notion_jobs}), \
                    mock.patch.object(desktop.store, 'connect', create=True), redirect_stdout(out):
                desktop.main(['jobs'])
            return json.loads(out.getvalue().strip().splitlines()[-1])['jobs']
        self.assertEqual(len(listed({'JOB_PILOTTO_STORE': 'sqlite'})), 3)
        with mock.patch.dict('os.environ', {}, clear=False):
            import os
            os.environ.pop('JOB_PILOTTO_STORE', None)
            self.assertIsNone(listed({}), 'no store chosen: the list is the cache, as before')


if __name__ == '__main__':
    unittest.main()
