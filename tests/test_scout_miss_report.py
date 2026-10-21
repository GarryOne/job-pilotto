"""The scout's miss report names where a site stopped, one fixed word each (tools/scout_miss_report.py)."""
import importlib.util
import json
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

from src.sources import careers

spec = importlib.util.spec_from_file_location('scout_miss_report', Path(__file__).resolve().parent.parent / 'tools' / 'scout_miss_report.py')
report = importlib.util.module_from_spec(spec)
spec.loader.exec_module(report)

SHELL = '<html><body><div id="app"></div><script>' + 'x' * 5000 + '</script></body></html>'
TEXTY = '<html><body><p>' + 'About our hospital and its wards. ' * 80 + '</p></body></html>'


class MissReportTest(unittest.TestCase):
    def run_site(self, pages):
        def get(url):
            page = pages.get(url)
            if isinstance(page, Exception):
                raise page
            if page is None:
                raise urllib.error.HTTPError(url, 404, 'gone', None, None)
            return page
        report.watch_plausible()
        with mock.patch.object(careers, 'get_text', get), mock.patch.object(careers, 'CHOOSER', None), mock.patch.object(careers, 'RENDER', None):
            return report.check('https://clinic.example/')['bucket']

    def test_a_site_that_turns_the_reader_away_is_refused_not_unreachable(self):
        self.assertEqual(self.run_site({'https://clinic.example/': urllib.error.HTTPError('u', 403, 'no', None, None)}), 'refused')

    def test_a_site_that_is_down_is_unreachable(self):
        self.assertEqual(self.run_site({'https://clinic.example/': urllib.error.URLError('dns')}), 'unreachable')

    def test_a_script_shell_is_named_as_one(self):
        self.assertEqual(self.run_site({'https://clinic.example/': SHELL}), 'home_is_a_script_shell')

    def test_a_readable_home_without_careers_link_is_named_so(self):
        self.assertEqual(self.run_site({'https://clinic.example/': TEXTY}), 'no_careers_link')

    def careers_site(self, title):
        posting = {'@context': 'https://schema.org', '@type': 'JobPosting', 'title': title, 'datePosted': '2026-10-01',
                   'description': '<p>Ward care.</p>', 'url': '/jobs/1',
                   'jobLocation': {'@type': 'Place', 'address': {'addressLocality': 'Lyon', 'addressCountry': 'FR'}}}
        page = f'<html><body><script type="application/ld+json">{json.dumps(posting)}</script></body></html>'
        return {'https://clinic.example/': TEXTY + '<a href="/careers">Careers</a>', 'https://clinic.example/careers': page}

    def test_json_ld_jobs_on_the_careers_page_are_found(self):
        self.assertEqual(self.run_site(self.careers_site('Site Reliability Engineer')), 'jobs_on_the_page')

    def test_jobs_the_reader_read_but_took_for_menu_entries_are_named_so(self):
        self.assertEqual(self.run_site(self.careers_site('Zorblax Wrangler')), 'jobs_rejected_as_menu_entries')


if __name__ == '__main__':
    unittest.main()
