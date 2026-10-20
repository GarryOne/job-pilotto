"""A refused site read in a user's own browser teaches every install (owner, 20 Oct 2026: "reuse any work/compute done on any installation so
other instalations can benefit and never do that same step again"): the outcome (opened, refused, a bot check, a login page) and, when it
opened, how many jobs and their kinds of work go up in the daily share as a fixed-shape site fact; served back, a site that stopped the browser
elsewhere is not asked again here, and one that opened elsewhere is asked first. No page, address path, title or person data leaves."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src import contribute
from src.sources import refused_reads, visits, visits_jobpages
from tests.test_refused_reads import BOARDS, JOBS, NOW, SEARCH

MIX = {'creative_media': 0.8, 'sales_retail': 0.2}


class SharedOutcomesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.index = Path(self.tmp.name) / 'employer_index.json'
        self.patches = [mock.patch.object(visits, 'STORE', Path(self.tmp.name) / 'visits.json'),
                        mock.patch('src.ai.board_ideas.load', lambda: json.loads(json.dumps(BOARDS))),
                        mock.patch.object(refused_reads, 'search_config', lambda: SEARCH),
                        mock.patch('src.role_kinds.mix', lambda titles: MIX if len(titles) >= 4 else None),
                        mock.patch('src.employer_index.CACHE', self.index)]
        for patch in self.patches:
            patch.start()
        visits.refused('Coop', 'https://jobs.coop.ch', 'HTTP 403', now=NOW)
        visits.refused('Manor', 'https://jobs.manor.ch', 'HTTP 403', now=NOW)

    def tearDown(self):
        for patch in self.patches:
            patch.stop()
        self.tmp.cleanup()

    def shared(self):
        return {fact['host']: fact['read'] for fact in contribute.site_facts() if fact['kind'] == 'browser_read'}

    def test_an_opened_site_shares_its_job_count_and_kinds_of_work(self):
        refused_reads.outcome('https://jobs.coop.ch', 200, JOBS, 'Careers', now=NOW)
        self.assertEqual(self.shared()['jobs.coop.ch'], {'outcome': 'opened', 'jobs': 4, 'kinds': MIX})

    def test_a_stop_shares_only_its_fixed_word(self):
        refused_reads.outcome('https://jobs.coop.ch', 403, '', now=NOW)
        refused_reads.outcome('https://jobs.manor.ch', 200, '<html><title>Just a moment...</title>captcha</html>', now=NOW)
        self.assertEqual(self.shared(), {'jobs.coop.ch': {'outcome': 'refused'}, 'jobs.manor.ch': {'outcome': 'bot'}})

    def test_nothing_but_the_fixed_shape_leaves(self):
        refused_reads.outcome('https://jobs.coop.ch', 200, JOBS, 'Careers', now=NOW)
        fact = next(f for f in contribute.site_facts() if f['kind'] == 'browser_read')
        self.assertEqual(set(fact), {'host', 'kind', 'read'})
        self.assertLessEqual(set(fact['read']), {'outcome', 'jobs', 'kinds'})

    def serve(self, facts):
        self.index.write_text(json.dumps({'fetched': NOW.isoformat(), 'feeds': [], 'sites': facts}))

    def test_served_outcomes_are_read_in_their_fixed_shape_only(self):
        self.serve([{'host': 'jobs.coop.ch', 'kind': 'browser_read', 'read': {'outcome': 'opened', 'jobs': 12}},
                    {'host': 'jobs.manor.ch', 'kind': 'browser_read', 'read': {'outcome': 'nonsense'}},
                    {'host': 'x.ch', 'kind': 'browser_read', 'read': 'opened'}])
        self.assertEqual(visits_jobpages.pool_facts().get('browser_read'), {'jobs.coop.ch': {'outcome': 'opened', 'jobs': 12}})

    def test_a_site_that_stopped_the_browser_elsewhere_is_not_asked_and_one_that_opened_comes_first(self):
        self.serve([{'host': 'jobs.manor.ch', 'kind': 'browser_read', 'read': {'outcome': 'opened', 'jobs': 30}},
                    {'host': 'jobs.coop.ch', 'kind': 'browser_read', 'read': {'outcome': 'bot'}}])
        hosts = [item['url'].split('/')[2] for item in refused_reads.queue(now=NOW)]
        self.assertNotIn('jobs.coop.ch', hosts)
        self.assertEqual(hosts[0], 'jobs.manor.ch')


if __name__ == '__main__':
    unittest.main()
