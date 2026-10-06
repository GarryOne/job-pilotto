"""A web search for an employer's own job site (src/sources/web_search.py), the scout's last step (6 Oct 2026: Coop's jobs are on coopjobs.ch and
jobs.coop.ch, Rolex's on carrieres-rolex.com: no guess from the name reaches them, a person finds them with one search)."""
import os
import unittest
from pathlib import Path
import sys
from unittest import mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import scout  # noqa: E402
from src.sources import web_search  # noqa: E402

BRAVE = {'web': {'results': [{'url': 'https://www.linkedin.com/company/coop/jobs'}, {'url': 'https://www.coopjobs.ch/de.html'},
                             {'url': 'https://jobs.coop.ch/'}, {'url': 'http://insecure.example/jobs'}]}}


class WebSearchTests(unittest.TestCase):
    def test_brave_first_then_serpapi_and_nothing_without_a_key(self):
        asked = []
        get = lambda url, headers=None: asked.append((url, headers)) or BRAVE
        with mock.patch.dict(os.environ, {'BRAVE_SEARCH_API_KEY': 'b', 'SERPAPI_API_KEY': 's', 'JOB_PILOTTO_DISABLE': ''}):
            self.assertEqual(web_search.job_sites('Coop', 'fr', get), ['https://www.coopjobs.ch/de.html', 'https://jobs.coop.ch/'])
        self.assertIn('api.search.brave.com', asked[0][0])
        self.assertIn('Coop+jobs+emplois', asked[0][0], 'the jobs word of the language goes into the search')
        with mock.patch.dict(os.environ, {'BRAVE_SEARCH_API_KEY': '', 'SERPAPI_API_KEY': 's', 'JOB_PILOTTO_DISABLE': ''}):
            self.assertEqual(web_search.provider(), 'serpapi')
        with mock.patch.dict(os.environ, {'BRAVE_SEARCH_API_KEY': '', 'SERPAPI_API_KEY': '', 'JOB_PILOTTO_DISABLE': ''}):
            self.assertEqual(web_search.job_sites('Coop', 'fr', get), [])
        with mock.patch.dict(os.environ, {'BRAVE_SEARCH_API_KEY': 'b', 'JOB_PILOTTO_DISABLE': 'web_search'}):
            self.assertIsNone(web_search.provider())

    def test_a_failed_search_is_an_empty_answer(self):
        def boom(url, headers=None):
            raise OSError('down')
        with mock.patch.dict(os.environ, {'BRAVE_SEARCH_API_KEY': 'b', 'JOB_PILOTTO_DISABLE': ''}):
            self.assertEqual(web_search.job_sites('Coop', '', boom), [])

    def test_the_scout_searches_only_when_name_website_and_job_hosts_found_nothing(self):
        jobs = [{'title': f'Vendeur {i}', 'location': 'Genève'} for i in range(9)]
        searched = []
        search = lambda name: searched.append(name) or ['https://www.coopjobs.ch/de.html']
        discover = lambda url: {'ats': 'careers', 'slug': 'coopjobs', 'jobs': jobs} if 'coopjobs' in url else None
        found = scout.find_feed({'name': 'Coop', 'website': 'https://www.coop.ch'}, lambda system, slug: None, discover, search=search)
        self.assertEqual((found[0], found[1], len(found[2])), ('careers', 'coopjobs', 9))
        self.assertEqual(searched, ['Coop'])
        searched.clear()
        known = scout.find_feed({'name': 'Coop', 'website': 'https://www.coop.ch'}, lambda system, slug: None,
                                lambda url: {'ats': 'careers', 'slug': 'coop', 'jobs': jobs} if url == 'https://www.coop.ch' else None, search=search)
        self.assertEqual(known[1], 'coop')
        self.assertEqual(searched, [], 'no search when the website already led to jobs')


if __name__ == '__main__':
    unittest.main()
