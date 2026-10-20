"""The Eightfold reader (src/sources/ats_eightfold.py): a site is found from its page, then read through its own /api/pcsx/search (fake pages and answers)."""
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.sources import ats, careers_explore  # noqa: E402

PAGE = ('<html><img src="https://static.vscdn.net/images/logo.png"><div data-nosnippet>{&#34;domain&#34;: &#34;acme.com&#34;, '
        '&#34;pcsDomain&#34;: &#34;jobs.acme.com&#34;}</div></html>')


def answer(ids):
    return {'status': 200, 'data': {'count': 1213, 'positions': [
        {'id': i, 'name': f'Shop Assistant {i}', 'locations': ['Giza, Egypt', 'Cairo, Egypt'], 'postedTs': 1792519147,
         'workLocationOption': 'onsite', 'positionUrl': f'/careers/job/{i}'} for i in ids]}}


class EightfoldTests(unittest.TestCase):
    def read(self, reply, terms=()):
        asked = []
        def get_json(url):
            asked.append(url)
            return reply(url)
        with mock.patch.object(ats, '_get', lambda url: PAGE.encode()), mock.patch.object(ats, '_json', get_json), \
                mock.patch.object(ats, 'workday_terms', lambda search=None: list(terms)):
            return ats.fetch('eightfold', 'jobs.acme.com'), asked

    def test_a_page_with_eightfolds_cdn_and_its_domain_settings_is_a_site(self):
        self.assertEqual(ats.eightfold_site(PAGE), 'jobs.acme.com')
        self.assertEqual(careers_explore._look(PAGE, 'https://jobs.acme.com/careers', lambda url: ''), {'ats': 'eightfold', 'slug': 'jobs.acme.com'})
        self.assertEqual(ats.eightfold_site(PAGE.replace('static.vscdn.net', 'cdn.example.com')), '')   # the CDN is the marker, not a word
        self.assertEqual(ats.eightfold_site('<p>a careers page that mentions eightfold.ai</p>'), '')

    def test_pages_of_ten_continue_while_full_and_the_employers_domain_is_asked(self):
        jobs, asked = self.read(lambda url: answer(range(1, 11) if 'start=0&' in url else range(11, 15)))
        self.assertEqual(len(jobs), 14)
        self.assertEqual(len(asked), 2)
        self.assertIn('https://jobs.acme.com/api/pcsx/search?domain=acme.com&query=&start=10&sort_by=timestamp', asked[1])
        self.assertEqual((jobs[0]['title'], jobs[0]['location'], jobs[0]['date_posted']), ('Shop Assistant 1', 'Giza, Egypt; Cairo, Egypt', '2026-10-20'))
        self.assertEqual(jobs[0]['url'], 'https://jobs.acme.com/careers/job/1')

    def test_each_of_the_users_words_is_searched_and_a_repeat_is_kept_once(self):
        jobs, asked = self.read(lambda url: answer([5, 6] if 'query=nurse' in url else [5]), terms=['nurse'])
        self.assertEqual(sorted(j['id'] for j in jobs), ['5', '6'])
        self.assertEqual(len(asked), 2)

    def test_a_host_that_is_not_a_plain_address_is_refused(self):
        for bad in ('', 'localhost', 'evil.com/x', 'a b.com'):
            with self.assertRaises(ValueError, msg=bad):
                ats.eightfold(bad)


if __name__ == '__main__':
    unittest.main()
