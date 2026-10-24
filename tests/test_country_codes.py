"""A job location a page gives as only a country code reads as the country's name (src/country_codes.py): a Moldovan board's IT jobs were located
"MD" and failed the place check (24 Oct 2026). One test loops over every code of the table; the JobPosting reader uses it."""
import json
import unittest

from src import country_codes
from src.sources import careers_parse


class CountryCodeTests(unittest.TestCase):
    def test_every_code_gives_a_name_that_is_not_a_code(self):
        for code, name in country_codes.NAMES.items():
            with self.subTest(code=code):
                self.assertEqual(country_codes.name(code.lower()), name)
                self.assertGreater(len(name), 2)

    def test_a_name_or_empty_text_stays_as_given(self):
        self.assertEqual((country_codes.name('Moldova'), country_codes.name(''), country_codes.name(None)), ('Moldova', '', ''))

    def test_a_posting_with_only_a_country_code_is_located_in_that_country(self):
        for code, name in (('MD', 'Moldova'), ('EE', 'Estonia'), ('CH', 'Switzerland'), ('KE', 'Kenya')):
            with self.subTest(code=code):
                posting = {'@type': 'JobPosting', 'title': 'Developer', 'url': 'https://x.example/j/1', 'hiringOrganization': {'name': 'Acme'},
                           'jobLocation': {'@type': 'Place', 'address': {'@type': 'PostalAddress', 'addressCountry': code}}}
                jobs = careers_parse.jsonld_jobs(f'<script type="application/ld+json">{json.dumps(posting)}</script>', 'https://x.example/j/1')
                self.assertEqual(jobs[0]['location'], name)


if __name__ == '__main__':
    unittest.main()
