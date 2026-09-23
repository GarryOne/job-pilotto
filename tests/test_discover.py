import json
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from discover import parse_jobs, city, mode, platform, useful_links, parse_tree

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

if __name__=='__main__':unittest.main()
