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

    def test_portal_searches_use_real_words_for_the_place_and_role(self):
        # 7 Oct 2026: gen[èe]ve became "gen ve", so LinkedIn ignored the place and showed the signed-in account's own job suggestions.
        self.assertEqual(visits._plain_words(['gen[èe]ve', 'z[uü]rich', 'vendeu(r|se)', 'photograph(e|er)?', '\\bsales associate\\b']),
                         ['genève', 'zürich', 'vendeur', 'photograph', 'sales associate'])
        urls = {p['key']: p['url'] for p in visits.portals({'role_keywords': ['photographe'], 'locations': {'top_tier': ['gen[èe]ve']}})}
        self.assertEqual(urls['linkedin'], 'https://www.linkedin.com/jobs/search/?keywords=photographe&location=gen%C3%A8ve')

    def test_a_refusing_site_and_the_portals_are_offered_least_recently_read_first(self):
        self.assertFalse(visits.refused('Down Co', 'https://down.example', 'URLError: timed out'), 'down is not a refusal')
        self.assertTrue(visits.refused('Coop', 'https://jobs.coop.ch', 'HTTP 403', now=NOW))
        listed = visits.visit_list(SEARCH, {'creative_media'}, now=NOW, picks=[])
        self.assertEqual([item['name'] for item in listed][:4], ['Coop', 'LinkedIn', 'Indeed', 'Glassdoor'])
        self.assertNotIn('levels.fyi', [item['name'] for item in listed], 'levels.fyi lists tech jobs: not for a photographer')
        self.assertIn('keywords=photographe&location=Gen%C3%A8ve', listed[1]['url'], 'the user\'s own words, not a regex')
        self.assertTrue(listed[2]['url'].startswith('https://ch.indeed.com/jobs?'), f"a Swiss search opens Switzerland's Indeed, not the US one: {listed[2]['url']}")
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
        names = [item['name'] for item in visits.visit_list(SEARCH, {'creative_media'}, now=NOW + timedelta(days=1), picks=[])]
        self.assertNotIn('LinkedIn', names, 'read yesterday: not offered again yet')
        self.assertIn('LinkedIn', [item['name'] for item in visits.visit_list(SEARCH, {'creative_media'}, now=NOW + timedelta(days=8), picks=[])])
        with mock.patch.object(visits, '_now', lambda: NOW + timedelta(days=30)):
            self.assertEqual(visits.fetch(second['feed']), [], 'an old visit stops serving its jobs')

    def test_the_scouts_unread_picks_for_this_search_come_before_the_portals(self):
        picks = [{'name': 'H&M Switzerland', 'url': 'https://www.hm.com'}, {'name': 'Manor', 'url': 'https://careers.manor.ch'}]
        names = [item['name'] for item in visits.visit_list(SEARCH, {'sales_retail'}, now=NOW, picks=picks)]
        self.assertEqual(names[:3], ['H&M Switzerland', 'Manor', 'LinkedIn'])

    def test_a_home_page_leads_to_its_job_list_and_the_list_then_opens_there(self):
        home = '<nav><a href="/watches">Watches</a> <a href="/joboffers/en">Careers</a></nav><h1>Time</h1>'
        self.assertEqual(visits.job_page('https://www.hublot.com/en-ch', home), 'https://www.hublot.com/joboffers/en')
        listed = visits.visit_list(SEARCH, {'sales_retail'}, now=NOW, picks=[{'name': 'Hublot', 'url': 'https://www.hublot.com'}])
        self.assertEqual(listed[0]['url'], 'https://www.hublot.com/joboffers/en', 'Open goes to the job list once found')

    def test_menu_cards_are_dropped_and_a_read_says_how_many_fit_the_search(self):
        # 7 Oct 2026: Glassdoor's menu ("Zum Inhalt springen", "Jobs", "Für dich") was read as jobs, and "Read 5 jobs from Indeed" grew nothing:
        # one of the five fit the search. Cards with a job id are the jobs; a read counts the ones the jobs check would keep.
        cards = [{'title': 'Zum Inhalt springen', 'url': '#main'}, {'title': 'Für dich', 'url': '/member/home'},
                 {'title': 'Photographer', 'url': '/rc/clk?jk=4a1b2c3d4e5f', 'lines': ['Studio AB', '1211 Geneva, GE']},
                 {'title': 'Solutions Engineer', 'url': '/rc/clk?jk=5a1b2c3d4e5f', 'lines': ['LHH', 'Geneva, GE']},
                 {'title': 'Photo assistant', 'url': '/rc/clk?jk=6a1b2c3d4e5f', 'lines': ['Studio C', 'Zürich']}]
        from src.sources import feeds
        with mock.patch.object(feeds, 'wanted_title', lambda title: 'photo' in title.lower()), \
                mock.patch.object(feeds, 'wanted_location', lambda job: 'geneva' in (job.get('location') or '').lower()):
            result = visits.read('https://ch.indeed.com/jobs?q=photographe', '<html></html>', cards, now=NOW)
        self.assertEqual([job['title'] for job in result['jobs']], ['Photographer', 'Solutions Engineer', 'Photo assistant'])
        self.assertEqual(result['fits'], 1, 'a photo job in Geneva: the one a jobs check keeps')

    def test_a_read_with_no_jobs_does_not_hide_the_site(self):
        # 7 Oct 2026: home pages read as 0 jobs hid Hublot and IWC from the list for a week.
        visits.read('https://www.hublot.com/en-ch', '<html></html>', [], now=NOW)
        listed = visits.visit_list(SEARCH, {'sales_retail'}, now=NOW + timedelta(hours=1), picks=[{'name': 'Hublot', 'url': 'https://www.hublot.com'}])
        self.assertEqual(listed[0]['name'], 'Hublot')

    def test_job_pages_are_found_before_the_tabs_open_for_your_country_and_kept(self):
        asked = []
        def search(name):
            asked.append(name)
            return {'Hublot': ['https://www.hublot.com/en-cy/job-offers', 'https://www.hublot.com/en-ch/job-offers'], 'Nobody': []}[name]
        sites = [{'name': 'Hublot', 'url': 'https://www.hublot.com', 'kind': 'employer'}, {'name': 'Nobody', 'url': 'https://nobody.example', 'kind': 'employer'},
                 {'name': 'Indeed', 'url': 'https://ch.indeed.com/jobs?q=x', 'kind': 'portal'}]
        with mock.patch('src.sources.web_search.provider', lambda: 'claude'):
            found = visits.find_job_pages(sites, ['ch'], search=search, now=NOW)
            self.assertEqual(found, {'https://www.hublot.com': 'https://www.hublot.com/en-ch/job-offers'}, 'the Swiss page, not the Cyprus one')
            visits.find_job_pages(sites, ['ch'], search=search, now=NOW + timedelta(days=1))
        self.assertEqual(asked, ['Hublot', 'Nobody'], 'a portal is never searched; a find and a miss are kept')
        listed = visits.visit_list(SEARCH, {'sales_retail'}, now=NOW, picks=[{'name': 'Hublot', 'url': 'https://www.hublot.com'}])
        self.assertEqual(listed[0]['url'], 'https://www.hublot.com/en-ch/job-offers')

    def test_a_job_list_read_by_a_claude_session_becomes_the_sites_job_page(self):
        cards = [{'title': f'Client Advisor {n}', 'url': f'/en/jobs/iwc/{n}23456', 'lines': ['IWC', 'Genève']} for n in range(3)]
        visits.read('https://careers.richemont.com/en/jobs/iwc?country=Switzerland', '<html></html>', cards, now=NOW, start='https://www.iwc.com')
        listed = visits.visit_list(SEARCH, {'sales_retail'}, now=NOW + timedelta(days=8), picks=[{'name': 'IWC', 'url': 'https://www.iwc.com'}])
        self.assertEqual(listed[0]['url'], 'https://careers.richemont.com/en/jobs/iwc?country=Switzerland')

    def test_a_job_page_that_shows_no_jobs_is_forgotten_and_not_chosen_again(self):
        # 7 Oct 2026: "a wrong job page sticks forever" (Jaeger-LeCoultre's was a US page).
        search = lambda name: ['https://www.maison.example/us-en/careers', 'https://www.maison.example/ch-fr/careers']
        site = [{'name': 'Maison', 'url': 'https://www.maison.example', 'kind': 'employer'}]
        with mock.patch('src.sources.web_search.provider', lambda: 'claude'):
            self.assertEqual(visits.find_job_pages(site, [], search=search, now=NOW), {'https://www.maison.example': 'https://www.maison.example/us-en/careers'})
            visits.read('https://www.maison.example/us-en/careers', '<html></html>', [], now=NOW)
            self.assertIn('maison.example', visits._load().get('jobpages'), 'one empty read may be a reading that failed: kept')
            visits.read('https://www.maison.example/us-en/careers', '<html></html>', [], now=NOW)
            self.assertNotIn('maison.example', visits._load().get('jobpages') or {}, 'forgotten after two reads with no jobs')
            again = visits.find_job_pages(site, [], search=search, now=NOW)
        self.assertEqual(again, {'https://www.maison.example': 'https://www.maison.example/ch-fr/careers'}, 'the next lookup skips the page that showed nothing')

    def test_an_employer_page_with_job_data_is_read_and_nothing_is_fetched(self):
        markup = '<script type="application/ld+json">' + json.dumps({'@type': 'JobPosting', 'title': 'Photographe', 'url': 'https://jobs.coop.ch/1',
                                                                      'jobLocation': {'address': {'addressLocality': 'Genève'}}}) + '</script>'
        with mock.patch.object(visits.careers, 'get_text', side_effect=AssertionError('fetched')):
            result = visits.read('https://jobs.coop.ch/offres', markup, now=NOW)
        self.assertEqual([job['title'] for job in result['jobs']], ['Photographe'])
        self.assertEqual(result['kind'], 'employer')


if __name__ == '__main__':
    unittest.main()


class FoundSiteTest(unittest.TestCase):
    """7 Oct 2026: the web search found Hublot's job page, which refuses the scout (403): the address is kept for the person to open."""
    def test_the_searchs_find_is_kept_when_it_cannot_be_read(self):
        from src import scout
        candidate = {'name': 'Hublot', 'website': 'https://www.hublot.com', 'status': 'pending'}
        found = scout.find_feed(candidate, probe=lambda system, slug: None, discover=lambda url: None,
                                search=lambda name: ['https://www.hublot.com/en-ch/job-offers'], jobsch_lookup=lambda name: None)
        self.assertIsNone(found)
        self.assertEqual(candidate['found_site'], 'https://www.hublot.com/en-ch/job-offers')
