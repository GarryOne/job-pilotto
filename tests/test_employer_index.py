"""The central employer index: download at most daily, cache, merge with the starter list, never fail a run."""
import json
import sys
import tempfile
import unittest
import urllib.error
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import employer_index, scout  # noqa: E402
from src import store as job_store  # noqa: E402

NOW = datetime(2026, 9, 30, 12, tzinfo=timezone.utc)
FEEDS = [{'company': 'Bigco', 'ats': 'lever', 'slug': 'bigco', 'quality': 80, 'checked': '2026-09-30'},
         {'company': 'Weird', 'ats': 'nonsense', 'slug': 'x'}, 'junk', {'company': 'NoSlug', 'ats': 'lever'}]


def server(calls, status=200, feeds=FEEDS, etag='"v1"'):
    def get(url, headers):
        calls.append((url, headers))
        if status == 304:
            return 304, '', None
        return status, json.dumps({'feeds': feeds}), etag
    return get


class LoadTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.cache = Path(self.tmp.name) / 'index.json'

    def tearDown(self):
        self.tmp.cleanup()

    def test_downloads_cleans_and_caches(self):
        calls = []
        feeds = employer_index.load(self.cache, 'https://x.test/api/index', server(calls), NOW)
        self.assertEqual([f['slug'] for f in feeds], ['bigco'])   # unknown ATS, junk and slug-less entries dropped
        self.assertEqual(len(calls), 1)
        self.assertTrue(self.cache.exists())

    def test_at_most_daily(self):
        calls = []
        employer_index.load(self.cache, 'u', server(calls), NOW)
        again = employer_index.load(self.cache, 'u', server(calls), NOW + timedelta(hours=5))
        self.assertEqual(len(calls), 1)
        self.assertEqual(len(again), 1)
        employer_index.load(self.cache, 'u', server(calls), NOW + timedelta(hours=21))
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[1][1]['If-None-Match'], '"v1"')   # revalidates instead of re-downloading

    def test_not_modified_keeps_the_cache(self):
        employer_index.load(self.cache, 'u', server([]), NOW)
        feeds = employer_index.load(self.cache, 'u', server([], status=304), NOW + timedelta(days=2))
        self.assertEqual([f['slug'] for f in feeds], ['bigco'])
        self.assertEqual(json.loads(self.cache.read_text())['fetched'], (NOW + timedelta(days=2)).isoformat(timespec='seconds'))

    def test_service_down_uses_the_old_cache(self):
        employer_index.load(self.cache, 'u', server([]), NOW)

        def down(url, headers):
            raise urllib.error.URLError('offline')
        feeds = employer_index.load(self.cache, 'u', down, NOW + timedelta(days=9))
        self.assertEqual([f['slug'] for f in feeds], ['bigco'])

    def test_service_down_and_no_cache_is_empty_not_an_error(self):
        def down(url, headers):
            raise urllib.error.URLError('offline')
        self.assertEqual(employer_index.load(self.cache, 'u', down, NOW), [])
        self.assertFalse(self.cache.exists())

    def test_garbage_answers_and_a_corrupt_cache_are_survived(self):
        self.cache.write_text('{not json')
        bad = lambda url, headers: (200, '<html>oops</html>', None)  # noqa: E731
        self.assertEqual(employer_index.load(self.cache, 'u', bad, NOW), [])

    def test_install_id_is_optional_and_validated(self):
        calls = []
        employer_index.load(self.cache, 'u', server(calls), NOW, install_id='abc-12345678')
        self.assertEqual(calls[0][1]['X-Install-Id'], 'abc-12345678')
        self.cache.unlink()
        calls.clear()
        employer_index.load(self.cache, 'u', server(calls), NOW, install_id='has spaces / and slashes')
        self.assertNotIn('X-Install-Id', calls[0][1])


class MergeTest(unittest.TestCase):
    STARTER = [{'company': 'Starter Name', 'ats': 'lever', 'slug': 'bigco', 'jobs': 3},
               {'company': 'Old', 'board': 'oldco'}]

    def test_starter_wins_and_index_adds(self):
        merged = employer_index.merge(self.STARTER, [{'company': 'Bigco', 'ats': 'lever', 'slug': 'bigco'},
                                                    {'company': 'Farco', 'ats': 'greenhouse', 'slug': 'farco'}])
        self.assertEqual([m['company'] for m in merged], ['Starter Name', 'Old', 'Farco'])

    def test_offline_the_starter_list_alone_works(self):
        self.assertEqual(len(employer_index.merge(self.STARTER, [])), 2)

    def test_active_sources_merges_index_local_feeds_and_exclusions(self):
        index = [{'company': 'Farco', 'ats': 'greenhouse', 'slug': 'farco'},
                 {'company': 'My Employer AG', 'ats': 'ashby', 'slug': 'mine'}]
        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.dict('os.environ', {'JOB_PILOTTO_EXCLUDED_COMPANIES': 'My Employer'}):
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                sources = scout.active_sources(db, None, self.STARTER, index)
        self.assertEqual({(s.get('ats', 'greenhouse'), s.get('slug') or s['board']) for s in sources},
                         {('lever', 'bigco'), ('greenhouse', 'oldco'), ('greenhouse', 'farco')})


class RelevantTest(unittest.TestCase):
    def test_only_feeds_with_roles_in_my_places_and_feeds_without_info(self):
        from src.sources import feeds
        index = [{'company': 'Zh', 'ats': 'lever', 'slug': 'zh', 'places': ['Zurich, Switzerland', 'Tokyo']},
                 {'company': 'Jp', 'ats': 'lever', 'slug': 'jp', 'places': ['Tokyo, Japan']},
                 {'company': 'Old', 'ats': 'lever', 'slug': 'old', 'places': None},
                 {'company': 'Rem', 'ats': 'lever', 'slug': 'rem', 'places': ['Remote']}]
        where = lambda job: 'zurich' in job['location'].lower() or 'remote' in job['location'].lower()  # noqa: E731
        self.assertEqual([f['company'] for f in employer_index.relevant(index, where)], ['Zh', 'Old', 'Rem'])
        self.assertEqual(employer_index.relevant(index, feeds.wanted_location)[1]['company'], 'Old')  # the real matcher

    def test_daily_uses_the_filter_unless_asked_for_everything(self):
        from src import daily
        index = [{'company': 'Zh', 'ats': 'lever', 'slug': 'zh', 'places': ['Nowhere-land']}]
        with mock.patch.object(employer_index, 'load', return_value=index), \
                mock.patch.dict('os.environ', {'JOB_PILOTTO_INDEX_ALL': ''}):
            self.assertEqual(daily.downloaded_index(), [])
        with mock.patch.object(employer_index, 'load', return_value=index), \
                mock.patch.dict('os.environ', {'JOB_PILOTTO_INDEX_ALL': '1'}):
            self.assertEqual(len(daily.downloaded_index()), 1)


class BuildAndPublishTest(unittest.TestCase):
    def fetch(self, system, slug):
        if slug == 'dead':
            raise urllib.error.URLError('gone')
        return [{'id': '1', 'title': 'Site Reliability Engineer', 'location': 'Zurich, Switzerland', 'url': 'u',
                 'date_posted': '2099-01-01', 'description': 'Kubernetes', 'remote': False, 'salary': ''}]

    def test_build_verifies_every_feed_and_drops_dead_ones(self):
        starter = [{'company': 'Bigco', 'ats': 'lever', 'slug': 'bigco'}, {'company': 'Dead', 'ats': 'lever', 'slug': 'dead'}]
        with tempfile.TemporaryDirectory() as tmp, job_store.connect(Path(tmp) / 'j.sqlite') as db:
            db.executescript(scout.TABLES)
            db.execute("INSERT INTO feed_sources (ats, slug, company, tier, quality, added_at) VALUES "
                       "('ashby', 'found', 'Found Co', 'Tier 1', 50, '2026-09-30')")
            feeds, failed = scout.build_index(db, starter, self.fetch, today='2026-09-30')
        self.assertEqual([f['company'] for f in feeds], ['Bigco', 'Found Co'])
        self.assertEqual(feeds[1]['tier'], 'Tier 1')
        self.assertTrue(all(f['checked'] == '2026-09-30' and 0 < f['quality'] <= 100 for f in feeds))
        self.assertEqual([f['company'] for f in failed], ['Dead'])
        self.assertEqual(feeds[0]['places'], ['Zurich, Switzerland'])
        self.assertEqual({f['kind'] for f in feeds}, {'employer'})

    def test_publish_sends_the_key_and_refuses_empty(self):
        seen = []

        def send(request):
            seen.append(request)
            return 200
        self.assertEqual(scout.publish_index([{'company': 'A', 'ats': 'lever', 'slug': 'a'}], 'https://x.test/api/index', 'k3y', send), 1)
        self.assertEqual(seen[0].get_method(), 'PUT')
        self.assertEqual(seen[0].get_header('Authorization'), 'Bearer k3y')
        self.assertEqual(json.loads(seen[0].data)['feeds'][0]['slug'], 'a')
        with self.assertRaises(ValueError):
            scout.publish_index([], 'https://x.test/i', 'k', send)
        with self.assertRaises(RuntimeError):
            scout.publish_index([{'company': 'A', 'ats': 'lever', 'slug': 'a'}], 'https://x.test/i', 'k', lambda r: 401)


if __name__ == '__main__':
    unittest.main()


class CentralLocationsTest(unittest.TestCase):
    def test_locations_file_replaces_places_only(self):
        from src import paths
        plain = paths.load_search_config()
        with mock.patch.dict('os.environ', {'JOB_PILOTTO_LOCATIONS_FILE': str(paths.ROOT / 'config' / 'central_locations.json')}):
            central = paths.load_search_config()
        self.assertEqual(central['role_keywords'], plain['role_keywords'])
        self.assertTrue(any('zurich' in p for p in central['locations']['top_tier']))
        self.assertTrue(any('singapore' in p for p in central['locations']['top_tier']))
        self.assertEqual(central['remote_excluded_regions'], ['(?!x)x'])   # no region is excluded for the shared index
