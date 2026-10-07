"""A JobPosting that gives only its region (jobs.ch: "addressRegion": "Geneve", no town) keeps that region as its place in every reader
(7 Oct 2026: saved as "Switzerland", Manor's Geneva jobs were closed as outside a Geneva search)."""
import io
import json
import unittest
from unittest import mock

from src.notion import ledger
from src.sources import boards, careers

POSTING = {'@context': 'https://schema.org', '@type': 'JobPosting', 'title': 'Site Reliability Engineer', 'url': 'https://www.jobs.ch/en/vacancies/detail/x/',
           'description': 'Geneva | Part-time 45%', 'hiringOrganization': {'name': 'Manor AG'},
           'jobLocation': {'@type': 'Place', 'address': {'@type': 'PostalAddress', 'addressRegion': 'Geneve', 'addressCountry': 'CH'}}}
PAGE = f'<html><script type="application/ld+json">{json.dumps(POSTING)}</script></html>'


class Response(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class PostingRegionTests(unittest.TestCase):
    def test_every_reader_keeps_the_region(self):
        places = {
            'boards.parse_jobs': boards.parse_jobs(PAGE, 'https://www.jobs.ch/en/vacancies/?term=sre', 'jobs.ch')[0]['location'],
            'careers.jsonld_jobs': careers.jsonld_jobs(PAGE, 'https://careers.example.com/')[0]['location'],
            'ledger.page_meta': ledger.page_meta('https://careers.example.com/x', opener=lambda *a, **k: Response(PAGE.encode())).get('location', ''),
        }
        self.assertEqual({name: 'Geneve' in place for name, place in places.items()}, {name: True for name in places}, places)

    def test_the_posting_page_names_the_place_the_search_page_left_out(self):
        job = {'source': 'jobs.ch', 'url': POSTING['url'], 'title': 'Site Reliability Engineer', 'location': 'Switzerland', 'profile': ''}
        client = mock.Mock(get=lambda url: {'url': url, 'html': PAGE})
        with mock.patch.object(boards, 'career_links', return_value=[], create=True):
            try:
                boards.enrich(('Manor AG', [job]), client)
            except Exception:  # noqa: BLE001 — the company part may need the network; the job is filled first
                pass
        self.assertEqual(job['location'], 'Geneve')


if __name__ == '__main__':
    unittest.main()
