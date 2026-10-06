"""Sites only you can open (7 Oct 2026): refusals and portals offered for a visit, a page a person sent read without fetching anything,
the pages of one paging session added up, portal jobs keeping their own employer, and the visit served as a feed."""
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

from src.sources import ats, visits

SEARCH = {'role_keywords': ['photographe', '\\bretouche\\b'], 'locations': {'top_tier': ['Genève'], 'country_wide': ['Suisse']}}
NOW = datetime(2026, 10, 7, 9, 0, tzinfo=timezone.utc)
CARDS = [{'title': 'Photographe de mode', 'url': '/jobs/view/111', 'lines': ['Photographe de mode', 'Studio Lumière', 'Genève, Suisse', 'il y a 2 jours']},
         {'title': 'Retoucheur photo', 'url': '/jobs/view/222', 'lines': ['Retoucheur photo', 'Atelier Blanc', 'Lausanne, Vaud, Suisse']}]


class VisitsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.patch = mock.patch.object(visits, 'STORE', Path(self.tmp.name) / 'visits.json')
        self.patch.start()

    def tearDown(self):
        self.patch.stop()
        self.tmp.cleanup()

    def test_a_refusing_site_and_the_portals_are_offered_least_recently_read_first(self):
        self.assertFalse(visits.refused('Down Co', 'https://down.example', 'URLError: timed out'), 'down is not a refusal')
        self.assertTrue(visits.refused('Coop', 'https://jobs.coop.ch', 'HTTP 403', now=NOW))
        listed = visits.visit_list(SEARCH, {'creative_media'}, now=NOW)
        self.assertEqual([item['name'] for item in listed][:4], ['Coop', 'LinkedIn', 'Indeed', 'Glassdoor'])
        self.assertNotIn('levels.fyi', [item['name'] for item in listed], 'levels.fyi lists tech jobs: not for a photographer')
        self.assertIn('keywords=photographe&location=Gen%C3%A8ve', listed[1]['url'], 'the user\'s own words, not a regex')
        self.assertTrue(listed[1]['note'].startswith('LinkedIn forbids'))
        self.assertTrue(visits.listed('https://www.linkedin.com/jobs/search/?x=1') and visits.listed('https://jobs.coop.ch/offres'))
        self.assertFalse(visits.listed('https://example.org/jobs'))

    def test_a_portal_page_is_read_from_its_cards_pages_add_up_and_a_read_site_waits_a_week(self):
        first = visits.read('https://www.linkedin.com/jobs/search/?keywords=photographe', '<html></html>', CARDS[:1], now=NOW, session='s1')
        second = visits.read('https://www.linkedin.com/jobs/search/?keywords=photographe&start=25', '<html></html>', CARDS, now=NOW, session='s1')
        self.assertEqual((first['added'], second['added'], len(second['jobs'])), (1, 1, 2))
        self.assertEqual(second['feed'], 'https://www.linkedin.com/jobs/search/?keywords=photographe', 'one feed for the whole paging session')
        jobs = {job['title']: job for job in ats.FETCHERS['visit'](second['feed'])}
        self.assertEqual((jobs['Photographe de mode']['employer'], jobs['Photographe de mode']['location']), ('Studio Lumière', 'Genève, Suisse'))
        self.assertEqual(jobs['Retoucheur photo']['url'], 'https://www.linkedin.com/jobs/view/222')
        names = [item['name'] for item in visits.visit_list(SEARCH, {'creative_media'}, now=NOW + timedelta(days=1))]
        self.assertNotIn('LinkedIn', names, 'read yesterday: not offered again yet')
        self.assertIn('LinkedIn', [item['name'] for item in visits.visit_list(SEARCH, {'creative_media'}, now=NOW + timedelta(days=8))])
        with mock.patch.object(visits, '_now', lambda: NOW + timedelta(days=30)):
            self.assertEqual(visits.fetch(second['feed']), [], 'an old visit stops serving its jobs')

    def test_an_employer_page_with_job_data_is_read_and_nothing_is_fetched(self):
        markup = '<script type="application/ld+json">' + json.dumps({'@type': 'JobPosting', 'title': 'Photographe', 'url': 'https://jobs.coop.ch/1',
                                                                      'jobLocation': {'address': {'addressLocality': 'Genève'}}}) + '</script>'
        with mock.patch.object(visits.careers, 'get_text', side_effect=AssertionError('fetched')):
            result = visits.read('https://jobs.coop.ch/offres', markup, now=NOW)
        self.assertEqual([job['title'] for job in result['jobs']], ['Photographe'])
        self.assertEqual(result['kind'], 'employer')


if __name__ == '__main__':
    unittest.main()
