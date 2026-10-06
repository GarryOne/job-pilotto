"""Opt-in contributions: only public facts and coarse tags leave, only when switched on, at most daily, never fatal."""
import json
import re
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import contribute  # noqa: E402

NOW = datetime(2026, 9, 30, 12, tzinfo=timezone.utc)
SEARCH = {'role_keywords': ['site reliability', '\\bsre\\b', 'platform engineer', 'security engineer'],
          'locations': {'top_tier': ['\\bzurich\\b', 'london'], 'country_wide': ['switzerland'], 'abroad': []}}
FEEDS = [{'company': 'Matched Co', 'ats': 'lever', 'slug': 'matched'}, {'company': 'Quiet Co', 'ats': 'lever', 'slug': 'quiet'},
         {'company': 'Mine Co', 'ats': 'greenhouse', 'slug': 'mine'}, {'company': 'Odd', 'ats': 'nonsense', 'slug': 'x'}]
REPORT = {'sources': [{'company': 'Matched Co', 'ok': True, 'total': 9, 'matches': 2}, {'company': 'Quiet Co', 'ok': True, 'total': 5, 'matches': 0}]}


class FakeTracker:
    def query_database(self, db, flt):
        return [{'properties': {'ATS': {'select': {'name': 'greenhouse'}}, 'Slug': {'rich_text': [{'plain_text': 'mine'}]},
                                'Company': {'title': [{'plain_text': 'Mine Co'}]}}}]


class TagsTest(unittest.TestCase):
    def test_tags_come_from_fixed_lists_only(self):
        roles, regions = contribute.tags(SEARCH)
        self.assertEqual(roles, ['security', 'sre_devops'])
        self.assertEqual(regions, ['europe'])
        for value in [*roles, *regions]:
            self.assertIn(value, {*contribute.ROLES, *contribute.REGIONS, 'other'})

    def test_unknown_profile_is_other_and_no_region(self):
        self.assertEqual(contribute.tags({'role_keywords': ['florist'], 'locations': {}}), (['other'], []))


class PayloadTest(unittest.TestCase):
    def test_only_matched_or_own_feeds_and_only_public_facts(self):
        body = contribute.payload(FEEDS, REPORT, FakeTracker(), install='abc-12345678', search=SEARCH)
        self.assertEqual({(f['slug'], f['matched'], f['own']) for f in body['feeds']},
                         {('matched', True, False), ('mine', False, True)})   # 'quiet' gave nothing; 'nonsense' is not a feed system
        self.assertEqual(set(body), {'v', 'install', 'roles', 'regions', 'feeds'})
        self.assertEqual(body['v'], 2)
        self.assertEqual(set(body['feeds'][0]), {'ats', 'slug', 'company', 'matched', 'own', 'how', 'site', 'failed', 'jobs', 'hits'} & set(body['feeds'][0]) | {'ats', 'slug', 'company', 'matched', 'own', 'how', 'site', 'failed'})
        for feed in body['feeds']:
            self.assertLessEqual(set(feed), {'ats', 'slug', 'company', 'matched', 'own', 'how', 'site', 'failed', 'jobs', 'hits'}, 'only public facts and counts')
        self.assertNotIn('Zurich', json.dumps(body))    # no search text: only fixed tags


class SendTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.stamp = Path(self.tmp.name) / 'sent.json'
        self.env = {'JOB_PILOTTO_SHARE_EMPLOYERS': '1', 'JOB_PILOTTO_INSTALL_ID': 'abc-12345678'}

    def tearDown(self):
        self.tmp.cleanup()

    def test_off_by_default_and_needs_an_install_id(self):
        self.assertFalse(contribute.enabled({}))
        self.assertFalse(contribute.enabled({'JOB_PILOTTO_SHARE_EMPLOYERS': '1'}))
        self.assertFalse(contribute.enabled({**self.env, 'JOB_PILOTTO_DISABLE': 'contribute'}))
        self.assertTrue(contribute.enabled(self.env))

    def test_nothing_is_sent_unless_opted_in(self):
        posts = []
        with mock.patch.dict('os.environ', {}, clear=True):
            self.assertFalse(contribute.maybe_send(FEEDS, REPORT, None, post=posts.append, stamp=self.stamp, search=SEARCH, now=NOW))
        self.assertEqual(posts, [])

    def test_sends_after_every_run_and_survives_a_dead_service(self):
        posts = []
        with mock.patch.dict('os.environ', self.env, clear=True):
            ok = lambda request: posts.append(request) or 200  # noqa: E731
            self.assertTrue(contribute.maybe_send(FEEDS, REPORT, None, post=ok, stamp=self.stamp, search=SEARCH, now=NOW, url='https://x.test/c'))
            self.assertTrue(contribute.maybe_send(FEEDS, REPORT, None, post=ok, stamp=self.stamp, search=SEARCH, now=NOW + timedelta(minutes=1)),
                            'no wait between runs: data is shared as it is produced')
            self.assertEqual(len(posts), 2)
            self.assertEqual(json.loads(posts[0].data)['install'], 'abc-12345678')

            def down(request):
                raise OSError('offline')
            self.stamp.unlink()
            self.assertFalse(contribute.maybe_send(FEEDS, REPORT, None, post=down, stamp=self.stamp, search=SEARCH, now=NOW))
            self.assertFalse(self.stamp.exists())   # not marked as sent: tried again next run
            self.assertFalse(contribute.maybe_send(FEEDS, REPORT, None, post=lambda r: 429, stamp=self.stamp, search=SEARCH, now=NOW))


if __name__ == '__main__':
    unittest.main()


class TradeTagsTests(unittest.TestCase):
    def test_every_role_tag_the_app_sends_is_one_the_website_keeps(self):
        """6 Oct 2026: a photographer's shares were all tagged 'other' (the tags knew only IT); the site drops a tag it does not list."""
        import re
        from src import contribute, role_kinds
        site = (Path(__file__).resolve().parents[1] / 'site' / 'src' / 'pool.js').read_text()
        accepted = set(re.findall(r"'(\w+)'", re.search(r'export const ROLES = \[([^\]]+)\]', site).group(1)))
        sendable = set(contribute.ROLES) | set(contribute.TRADE_ROLES) | {'other'}
        self.assertEqual(sendable, accepted)
        self.assertEqual(set(contribute.TRADE_ROLES), set(role_kinds.KINDS) - {'software', 'other'})
        roles, _ = contribute.tags({'role_keywords': ['vendeu(r|se)', 'magasinier', 'photograph(e|er)?'], 'locations': {'top_tier': ['geneva']}})
        self.assertEqual(roles, ['creative_media', 'logistics', 'sales_retail'])


class FoundHereTests(unittest.TestCase):
    def test_every_feed_the_scout_verified_is_shared_with_how_it_was_found(self):
        """6 Oct 2026: only feeds that had matched a job went, so Coop or Manor stayed on the Mac until one of their jobs matched."""
        import sqlite3
        db = sqlite3.connect(':memory:')
        db.execute('CREATE TABLE feed_sources (ats TEXT, slug TEXT, company TEXT, active INTEGER)')
        db.execute('CREATE TABLE scout_candidates (ats TEXT, slug TEXT, origin TEXT, careers TEXT)')
        db.execute("INSERT INTO feed_sources VALUES ('successfactors', 'jobs.coop.ch', 'Coop', 1)")
        db.execute("INSERT INTO scout_candidates VALUES ('successfactors', 'jobs.coop.ch', 'AI idea 2026-10-06', 'https://jobs.coop.ch/')")
        feeds = [{'company': 'Coop', 'ats': 'successfactors', 'slug': 'jobs.coop.ch'}]
        report = {'sources': [{'company': 'Coop', 'ok': True, 'total': 3142, 'matches': 0}]}
        body = contribute.payload(feeds, report, None, install='abc-12345678', search=SEARCH, db=db)
        self.assertEqual(body['feeds'], [{'ats': 'successfactors', 'slug': 'jobs.coop.ch', 'company': 'Coop', 'matched': False, 'own': False,
                                         'how': 'ai_idea', 'site': 'https://jobs.coop.ch/', 'jobs': 3142, 'hits': 0, 'failed': False}])
        self.assertEqual(set(word for _, word in contribute.HOW) | {'index', 'own', 'other'},
                         set(re.findall(r"'(\w+)'", re.search(r'export const HOW = \[([^\]]+)\]',
                             (Path(__file__).resolve().parents[1] / 'site' / 'src' / 'pool.js').read_text()).group(1))),
                         'the words the app sends are the words the site keeps')


class DeadEndTests(unittest.TestCase):
    def test_no_readable_job_site_is_shared_and_then_skipped_by_other_installs(self):
        """6 Oct 2026: every install probed the same employers with no readable job site."""
        import sqlite3
        from datetime import datetime, timezone
        from src import employer_index, scout
        db = sqlite3.connect(':memory:')
        db.execute('CREATE TABLE scout_candidates (name TEXT, website TEXT, status TEXT, checked_at TEXT, checked_with TEXT)')
        today = datetime.now(timezone.utc).isoformat(timespec='seconds')
        db.execute("INSERT INTO scout_candidates VALUES ('Fnac Suisse', 'https://www.fnac.ch/fr', 'none', ?, ?)", (today, scout.READERS))
        db.execute("INSERT INTO scout_candidates VALUES ('Old Readers', 'https://old.ch', 'none', ?, 'aaaaaaaaaaaa')", (today,))
        self.assertEqual(contribute.dead_ends(db), [{'company': 'Fnac Suisse', 'host': 'fnac.ch'}], 'only what the current readers found')
        with tempfile.TemporaryDirectory() as tmp:
            cache = Path(tmp) / 'index.json'
            cache.write_text(json.dumps({'feeds': [], 'nofeed': [{'key': 'fnacsuisse', 'last': today[:10]}, {'key': 'stale', 'last': '2020-01-01'}]}))
            self.assertEqual(employer_index.central_nofeed(cache), {'fnacsuisse'}, 'older than 30 days: probed again')


class ShareNowTests(unittest.TestCase):
    """6 Oct 2026, owner: send what an install learns right away, so closing the app loses nothing."""
    def test_one_find_or_one_dead_end_goes_at_once_and_only_when_sharing_is_on(self):
        posts = []
        ok = lambda request: posts.append(json.loads(request.data)) or 200  # noqa: E731
        on = {'JOB_PILOTTO_SHARE_EMPLOYERS': '1', 'JOB_PILOTTO_INSTALL_ID': 'abc-12345678'}
        with mock.patch.dict('os.environ', on, clear=True), mock.patch.object(contribute, 'tags', lambda search=None: (['sales_retail'], ['europe'])):
            self.assertTrue(contribute.share_now(feed={'ats': 'successfactors', 'slug': 'jobs.coop.ch', 'company': 'Coop', 'how': 'ai_idea'}, post=ok, url='https://x.test/c'))
            self.assertTrue(contribute.share_now(dead={'company': 'Fnac Suisse', 'host': 'fnac.ch'}, post=ok, url='https://x.test/c'))
        self.assertEqual([len(p['feeds']) for p in posts], [1, 0])
        self.assertEqual(posts[1]['nofeed'], [{'company': 'Fnac Suisse', 'host': 'fnac.ch'}])
        self.assertEqual(posts[0]['feeds'][0]['how'], 'ai_idea')
        with mock.patch.dict('os.environ', {}, clear=True):
            self.assertFalse(contribute.share_now(feed={'ats': 'lever', 'slug': 'x', 'company': 'X'}, post=ok))
        self.assertEqual(len(posts), 2, 'sharing off: nothing sent')

    def test_the_scout_sends_each_verified_employer_and_dead_end_as_it_records_it(self):
        from src import scout, store as job_store
        sent = []
        with tempfile.TemporaryDirectory() as tmp, job_store.connect(Path(tmp) / 'jobs.sqlite') as db, \
                mock.patch.object(contribute, 'share_now', lambda feed=None, dead=None, **k: sent.append('feed' if feed else 'dead') or True):
            seeds = {'excluded': [], 'tier1_known': [], 'tier1': [], 'manual_watch': [], 'regional': {}, 'tech_only': False}
            names = [dict(name='Found Co', origin='AI idea 2026-10-06', priority=92, ats='lever', slug='found'), dict(name='Nothing Co', origin='AI idea 2026-10-06', priority=91, website='https://nothing.example')]
            probe = lambda system, slug: [{'title': 'Vendeur', 'location': 'Geneva', 'url': 'u', 'description': ''}] * 3 if slug == 'found' else None
            with mock.patch.object(scout.careers, 'discover', lambda url: None), \
                    mock.patch.object(scout, 'quality', lambda jobs: (80, {'preferred': 2, 'relevant': 3, 'jobs': len(jobs)})):
                scout.run(db, 5, None, seeds, probe, harvest_sources=[lambda: names])
        self.assertEqual(sorted(sent), ['dead', 'feed'])
