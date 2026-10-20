"""The Oracle Recruiting Cloud reader (src/sources/ats_oracle.py), and the registration every feed type needs (a fetcher, a board address, a Notion option):
one loop over all of ats.FETCHERS so a new feed type added without them fails here."""
import json
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import scout_probe  # noqa: E402
from src.sources import ats  # noqa: E402

SLUG = 'acmehotels.us2.CX_1'


def page(ids, size):
    """The endpoint's answer for `ids` (fake data): one search record holding the requisition list."""
    return {'items': [{'TotalJobsCount': 4471, 'requisitionList': [
        {'Id': str(i), 'Title': f'Night Receptionist {i}', 'PostedDate': '2026-10-20', 'PrimaryLocation': 'Lisbon, Portugal',
         'ShortDescriptionStr': '<p>Welcome guests.</p>', 'WorkplaceType': 'On-site'} for i in ids][:size]}]}


class OracleTests(unittest.TestCase):
    def read(self, answer, terms=()):
        asked = []
        def get_json(url):
            asked.append(url)
            return answer(url)
        with mock.patch.object(ats, '_json', get_json), mock.patch.object(ats, 'workday_terms', lambda search=None: list(terms)):
            return ats.fetch('oracle', SLUG), asked

    def test_a_site_address_is_found_in_a_link_with_or_without_a_language(self):
        for link in ('https://acmehotels.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs',
                     'https://acmehotels.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/sites/CX_1',
                     'https://acmehotels.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/pt-PT/sites/CX_1/my-profile/sign-in'):
            self.assertEqual(ats.detect(link), ('oracle', SLUG), link)
        self.assertIsNone(ats.detect('https://acmehotels.fa.us2.oraclecloud.com/other'))

    def test_a_slug_must_be_three_plain_parts(self):
        for bad in ('', 'acme', 'acme.us2', 'ACME.us2.CX_1', 'a b.us2.CX_1', 'acme.us2.CX 1', 'acme/evil.us2.CX_1'):
            with self.assertRaises(ValueError, msg=bad):
                ats.split_oracle(bad)

    def test_the_newest_jobs_are_read_without_a_word_in_pages_of_100_and_a_short_page_ends_it(self):
        jobs, asked = self.read(lambda url: page(range(100 if 'offset=0,' in url else 7), 100))
        self.assertEqual(len(jobs), 100)   # the second page repeats ids 0-6: seen once
        self.assertEqual(len(asked), 2)
        self.assertIn('siteNumber=CX_1,limit=100,offset=100,sortBy=POSTING_DATES_DESC', asked[1])
        self.assertTrue(asked[0].startswith('https://acmehotels.fa.us2.oraclecloud.com/hcmRestApi/'))
        self.assertEqual(jobs[0]['url'], 'https://acmehotels.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/0')
        self.assertEqual((jobs[0]['title'], jobs[0]['location'], jobs[0]['description']), ('Night Receptionist 0', 'Lisbon, Portugal', 'Welcome guests.'))

    def test_each_of_the_users_words_is_searched_once_and_its_jobs_join_the_list(self):
        def answer(url):
            return page([500, 501] if 'keyword=nurse%20night' in url else [1, 2], 100)
        jobs, asked = self.read(answer, terms=['nurse night'])
        self.assertEqual(sorted(j['id'] for j in jobs), ['1', '2', '500', '501'])
        self.assertEqual(len(asked), 2)
        self.assertIn('limit=50,offset=0,sortBy=POSTING_DATES_DESC,keyword=nurse%20night', asked[1])

    def test_a_site_with_no_jobs_gives_an_empty_list_not_an_error(self):
        jobs, _ = self.read(lambda url: {'items': [{'TotalJobsCount': 0}]})
        self.assertEqual(jobs, [])


# 'visit' lives on one install only; 'jobsch' never had a select option (checked 20 Oct 2026: left as it was, not part of this change).
NO_NOTION_OPTION = {'visit', 'jobsch'}


class EveryFeedTypeIsRegisteredTests(unittest.TestCase):
    def test_every_feed_type_has_a_board_address_and_a_notion_option(self):
        schema = json.loads((Path(__file__).resolve().parents[1] / 'config' / 'notion_schema.json').read_text())
        names = {part.split('"')[0] for part in json.dumps(schema, indent=2).split('"name": "')[1:]}
        slugs = {'oracle': 'acme.us2.CX_1', 'workday': 'acme.wd3.Site', 'successfactors': 'careers.acme.com', 'jobsch': 'acme', 'careers': 'x', 'visit': 'x'}
        for system in ats.FETCHERS:
            with self.subTest(system=system):
                scout_probe.board_url(system, slugs.get(system, 'acme'))   # raises KeyError when the system has no entry
                if system not in NO_NOTION_OPTION:
                    self.assertIn(system, names, 'config/notion_schema.json has no select option for it')


if __name__ == '__main__':
    unittest.main()
