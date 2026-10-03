import json
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from src.sources.boards import parse_jobs, city, mode, platform, useful_links, parse_tree, parse_swissdevjobs, swiss_places

SDJ = {'jobUrl': 'Acme-AG-Site-Reliability-Engineer', 'name': 'Site Reliability Engineer', 'company': 'Acme AG', 'actualCity': 'Zürich', 'workplace': 'hybrid',
       'expLevel': 'Senior', 'jobType': 'Full-Time', 'technologies': ['Kubernetes', 'Terraform'], 'language': 'English', 'hasVisaSponsorship': 'No',
       'annualSalaryFrom': 120000, 'annualSalaryTo': 150000, 'activeFrom': '2026-10-02T00:00:00.000+02:00', 'companyWebsiteLink': 'acme.example', 'isPaused': False}


class SwissDevJobsTests(unittest.TestCase):
    def test_a_listed_job_becomes_a_job_with_a_description_written_from_its_facts(self):
        job, = parse_swissdevjobs([SDJ])
        self.assertEqual((job['company'], job['title'], job['source']), ('Acme AG', 'Site Reliability Engineer', 'SwissDevJobs'))
        self.assertEqual(job['url'], 'https://swissdevjobs.ch/jobs/Acme-AG-Site-Reliability-Engineer')
        self.assertEqual((job['location'], job['city'], job['work_mode'], job['date_posted']), ('Zürich, Switzerland', 'Zurich', 'Hybrid (stated)', '2026-10-02'))
        self.assertEqual(job['salary'], {'currency': 'CHF', 'min': 120000, 'max': 150000})
        for fact in ('Level: Senior', 'Technologies: Kubernetes, Terraform', 'Working language: English', 'Visa sponsorship: No', 'Annual salary (CHF): 120000 to 150000'):
            self.assertIn(fact, job['description'])

    def test_paused_jobs_other_roles_and_junk_are_left_out(self):
        listing = [{**SDJ, 'isPaused': True}, {**SDJ, 'name': 'Office Manager', 'jobUrl': 'x'}, {**SDJ, 'jobUrl': ''}, 'junk', None]
        self.assertEqual(parse_swissdevjobs(listing), [])
        self.assertEqual(parse_swissdevjobs({'error': 'x'}), [])
        self.assertEqual(parse_swissdevjobs([SDJ], wanted=lambda title: 'backend' in title.lower()), [])   # the crawl passes the search's own roles
        self.assertIsNone(parse_swissdevjobs([{**SDJ, 'annualSalaryFrom': None, 'annualSalaryTo': None}])[0]['salary'])


class DiscoveryTests(unittest.TestCase):
    def test_swiss_jobs_and_expiry(self):
        base={'@type':'JobPosting','title':'Software Engineer','hiringOrganization':{'name':'Example'},'jobLocation':{'address':{'addressCountry':'CH','addressLocality':'Genève'}},'url':'/job/1'}
        us={**base,'jobLocation':{'address':{'addressCountry':'US','addressLocality':'Geneva'}}}
        expired={**base,'validThrough':'2020-01-01'}
        nontech={**base,'title':'Account Manager'}
        page='<script type="application/ld+json">'+json.dumps([base,us,expired,nontech])+'</script>'
        result=parse_jobs(page,'https://example.com','test')
        self.assertEqual(len(result),1);self.assertEqual(result[0]['city'],'Geneva')
        self.assertEqual(result[0]['work_mode'],'Not stated')
    def test_locations_modes_and_links(self):
        self.assertEqual(city('Zürich, Genève'),'Zurich, Geneva')
        self.assertEqual(mode('Hybrid / remote'),'Hybrid (stated)')
        self.assertEqual(mode('Homeoffice möglich'),'Remote mentioned; verify conditions')
        self.assertEqual(platform('https://jobs.eu.lever.co/a'),'Lever')
        self.assertEqual(platform('https://lever.co.evil.example/a'),'Company website / unknown ATS')
        links=useful_links('<a href="/careers">Careers</a><a href="https://linkedin.com/jobs/a">Jobs</a><a href="javascript:alert(1)">Careers</a>','https://example.com')
        self.assertEqual(links,['https://example.com/careers'])
    def test_tree_does_not_include_global_remote(self):
        block='<a href="/job/1"><h3>Software Engineer</h3><p>Example</p><span class="truncate text-foreground">{}</span></a>'
        self.assertEqual(parse_tree(block.format('Remote')),[])
        self.assertEqual(len(parse_tree(block.format('Zürich'))),1)

    def test_board_discovery_only_for_swiss_places(self):
        self.assertTrue(swiss_places({'locations':{'top_tier':['zürich'],'country_wide':[],'abroad':[]}}))
        self.assertTrue(swiss_places({'locations':{'top_tier':['berlin'],'country_wide':['switzerland']}}))
        self.assertFalse(swiss_places({'locations':{'top_tier':['amsterdam','berlin'],'country_wide':['netherlands','germany'],'abroad':[]}}))
        self.assertFalse(swiss_places({}))

    def test_company_site_searches_follow_the_strategy(self):
        from unittest import mock
        from src.sources import ats
        config={'role_keywords':['data analyst','\\bbi\\b','/odd.*regex/','a','b','c'],
                'locations':{'top_tier':['amsterdam'],'country_wide':['netherlands'],'abroad':['berlin']}}
        with mock.patch('src.paths.load_search_config',return_value=config):
            self.assertEqual(ats.search_roles(),('data analyst','bi','a','b'))
            self.assertEqual(ats.search_places(),('Berlin','Netherlands'))
        with mock.patch('src.paths.load_search_config',return_value={'role_keywords':[],'locations':{'top_tier':['z[uü]rich']}}):
            self.assertEqual(ats.search_roles(),());self.assertEqual(ats.search_places(),('Zürich',))
    def test_cloud_runs_read_the_search_settings_page(self):
        root=Path(__file__).resolve().parents[1]/'.github'/'workflows'
        for name in ('daily.yml','scout.yml'):
            self.assertIn('NOTION_SEARCH_SETTINGS_PAGE: ${{ vars.NOTION_SEARCH_SETTINGS_PAGE }}',(root/name).read_text(),name)

if __name__=='__main__':unittest.main()
