"""An employer's jobs on jobs.ch (src/sources/ats.py jobsch), and the scout finding an employer there when its own job site cannot be read
(6 Oct 2026: Manor, 287 jobs on jobs.ch, careers site a script app; Fnac's site refuses automated visitors)."""
import json
import unittest
from pathlib import Path
import sys
from unittest import mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import scout  # noqa: E402
from src.sources import ats  # noqa: E402


def page(postings, start=0):
    items = [{'@type': 'JobPosting', 'title': title, 'url': f'https://www.jobs.ch/en/vacancies/detail/{start + i:08d}-0000-0000-0000-000000000000/',
              'datePosted': '2026-10-01T10:00:00', 'hiringOrganization': {'name': org, 'sameAs': f'https://www.jobs.ch/en/companies/{cid}-{cid}-x/'},
              'jobLocation': {'address': {'addressLocality': city, 'addressCountry': 'CH'}}} for i, (title, org, cid, city) in enumerate(postings)]
    return ('<script type="application/ld+json">' + json.dumps({'@graph': items}) + '</script>').encode()


class JobsChEmployerTests(unittest.TestCase):
    def test_only_the_employers_own_postings_page_by_page(self):
        first = [('Vendeur', 'Manor AG', 27602, 'Genève')] * 15 + [('Barista', 'Other AG', 999, 'Genève')] * 5
        pages = {1: page([(t, o, c, city) for i, (t, o, c, city) in enumerate(first)]), 2: page([('Caissier', 'Manor AG', 27602, 'Vevey')], start=100)}
        asked = []
        def get(url):
            asked.append(url)
            return pages[int(url.rsplit('page=', 1)[1])]
        with mock.patch.object(ats, '_get', get):
            jobs = ats.jobsch('27602-manor-ag')
        self.assertEqual(len(asked), 2, 'a short page is the last')
        self.assertIn('term=manor+ag', asked[0])
        self.assertEqual({j['location'] for j in jobs}, {'Genève, Switzerland', 'Vevey, Switzerland'})
        self.assertNotIn('Barista', {j['title'] for j in jobs})

    def test_the_company_link_gives_its_id(self):
        self.assertEqual(ats.jobsch_company('https://www.jobs.ch/en/companies/27602-27602-manor-ag/'), '27602-manor-ag')
        self.assertEqual(ats.jobsch_company('https://www.jobs.ch/en/companies/27602-manor-ag/'), '27602-manor-ag')
        self.assertEqual(ats.jobsch_company('https://example.com'), '')

    def test_the_scout_takes_jobs_ch_when_nothing_else_reads_and_its_own_site_first(self):
        listed = [{'title': 'Vendeur', 'location': 'Genève'}] * 4
        probe = lambda system, slug: listed if system == 'jobsch' else None
        found = scout.find_feed({'name': 'Manor', 'website': 'https://www.manor.ch'}, probe, lambda url: None,
                                jobsch_lookup=lambda name: {'slug': '27602-manor-ag', 'site': 'https://careers.manor.ch'})
        self.assertEqual(found[:2], ('jobsch', '27602-manor-ag'))
        own = scout.find_feed({'name': 'Manor', 'website': 'https://www.manor.ch'}, probe,
                              lambda url: {'ats': 'careers', 'slug': 'careers.manor.ch', 'jobs': listed * 3} if 'careers.manor' in url else None,
                              jobsch_lookup=lambda name: {'slug': '27602-manor-ag', 'site': 'https://careers.manor.ch'})
        self.assertEqual(own[:2], ('careers', 'careers.manor.ch'), 'its own job site, when readable, wins over the board')

    def test_a_similar_name_is_not_the_employer(self):
        search = page([('Vendeur', 'Manor Food AG', 1, 'Basel')])
        self.assertIsNone(ats.jobsch_find('Manor', scout.key_for, get=lambda url: search))


if __name__ == '__main__':
    unittest.main()
