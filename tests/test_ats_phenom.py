"""The Phenom reader (src/sources/ats_phenom.py): a site is found from its page, then read through its own /widgets search (fake pages and answers)."""
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.sources import ats, careers_explore  # noqa: E402

HOME = ('<html><head><link rel="canonical" href="https://careers.acme-logistics.com/global/en/home"></head><body>'
        '<script src="https://cdn.phenompeople.com/x.js"></script><script>phApp={"refNum":"ACMEGLOBAL","pageId":"page12",'
        '"widgetApiEndpoint":"https://careers.acme-logistics.com/widgets"}</script></body></html>')


def answer(ids, **extra):
    return {'refineSearch': {'totalHits': 9000, 'data': {'jobs': [
        {'jobSeqNo': f'ACMEGLOBAL{i}', 'jobId': str(i), 'title': f'Class 2 Driver {i}', 'location': 'Barming, United Kingdom',
         'postedDate': '2026-10-20T12:51:54.000+0000', 'descriptionTeaser': 'Deliver parcels.', 'workHours': 'Full-time', **extra} for i in ids]}}}


class PhenomTests(unittest.TestCase):
    def read(self, reply, terms=()):
        sent = []
        def post(url, body):
            sent.append(body)
            return reply(body)
        with mock.patch.object(ats, '_get', lambda url: HOME.encode()), mock.patch('src.sources.ats_phenom._post', post), \
                mock.patch.object(ats, 'workday_terms', lambda search=None: list(terms)):
            return ats.fetch('phenom', 'careers.acme-logistics.com'), sent

    def test_a_page_that_names_its_widgets_address_is_a_phenom_site(self):
        self.assertEqual(ats.phenom_site(HOME), 'careers.acme-logistics.com')
        self.assertEqual(careers_explore._look(HOME, 'https://careers.acme-logistics.com/global/en', lambda url: ''),
                         {'ats': 'phenom', 'slug': 'careers.acme-logistics.com'})
        self.assertEqual(ats.phenom_site('<script>"widgetApiEndpoint":"https://x.example.com/widgets"</script>'), '')   # not Phenom's own marker
        self.assertEqual(ats.phenom_site(''), '')

    def test_the_search_carries_the_pages_own_reference_and_language(self):
        jobs, sent = self.read(lambda body: answer(range(3)))
        self.assertEqual((sent[0]['refNum'], sent[0]['lang'], sent[0]['pageId'], sent[0]['keywords'], sent[0]['size']), ('ACMEGLOBAL', 'en_global', 'page12', '', 50))
        self.assertEqual((jobs[0]['title'], jobs[0]['location'], jobs[0]['date_posted'], jobs[0]['description']),
                         ('Class 2 Driver 0', 'Barming, United Kingdom', '2026-10-20', 'Deliver parcels.'))
        self.assertEqual(jobs[0]['url'], 'https://careers.acme-logistics.com/global/en/job/ACMEGLOBAL0')

    def test_pages_continue_while_full_and_a_short_page_ends_a_search(self):
        jobs, sent = self.read(lambda body: answer(range(body['from'], body['from'] + (50 if body['from'] < 100 else 7))))
        self.assertEqual([b['from'] for b in sent], [0, 50, 100])
        self.assertEqual(len(jobs), 107)

    def test_each_of_the_users_words_is_searched_and_a_job_found_twice_is_kept_once(self):
        def reply(body):
            return answer([1, 2] if not body['keywords'] else [2, 900])
        jobs, sent = self.read(reply, terms=['driver'])
        self.assertEqual(sorted(j['id'] for j in jobs), ['ACMEGLOBAL1', 'ACMEGLOBAL2', 'ACMEGLOBAL900'])
        self.assertEqual([b['keywords'] for b in sent], ['', 'driver'])

    def test_a_host_that_is_not_a_plain_address_is_refused(self):
        for bad in ('', 'localhost', 'evil.com/x', 'a b.com', 'EVIL.COM'):
            with self.assertRaises(ValueError, msg=bad):
                ats.phenom(bad)


if __name__ == '__main__':
    unittest.main()
