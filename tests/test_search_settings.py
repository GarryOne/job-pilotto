import json
import re
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src.notion import search_settings as s

FILES = {
    'search': {'role_keywords': ['site reliability', r'\bsre\b', 'platform engineer'],
               'title_exclude_keywords': [r'\bjunior\b', 'intern(ship)?', r'\bhr\b business partner'],
               'quality_stack_keywords': ['kubernetes', r'slo\b'],
               'locations': {'top_tier': ['z[uü]rich', r'\bzug\b'], 'country_wide': ['switzerland', r'st\.? ?gallen'], 'abroad': []},
               'remote_excluded_regions': [r'\busa?\b', 'canada'],
               'jobs_board_search_queries': ['site reliability engineer'], 'board_discovery_keywords': ['devops'],
               'google_jobs': {'queries': ['sre'], 'country': 'ch', 'searches_per_run': 1,
                               'locations': [{'location': 'Zurich,Zurich,Switzerland', 'language': 'de'}]}},
    'preferences': {'excluded_companies': ['Acme Corp'], 'disqualifying_languages': ['French', 'German'], 'digest_min_score': 50},
}


def page(markdown):  # how Tracker.page_text returns a page: headings as "## …", bullets as "- …"
    return markdown


class SearchSettingsTests(unittest.TestCase):
    def test_the_page_shows_plain_words_quotes_for_whole_words_and_regex_only_when_needed(self):
        self.assertEqual([s.readable(f) for f in ('site reliability', r'\bsre\b', 'z[uü]rich', 'on-call', 'intern(ship)?', 'développeur')],
                         ['site reliability', '"sre"', 'zürich', 'on-call', '/intern(ship)?/', 'développeur'])

    def test_entries_match_like_the_fragments_did(self):
        find = lambda entry, text: bool(re.search(s.fragment(entry), text, re.I))
        self.assertTrue(find('entwickler', 'Softwareentwickler (m/w/d)'))  # anywhere, as before
        self.assertTrue(find('zürich', 'Zurich, Switzerland') and find('zürich', 'ZÜRICH'))
        self.assertTrue(find('"sre"', 'Senior SRE (m/f)'))
        self.assertFalse(find('"sre"', 'Srebrenica office'))  # quotes: whole word
        self.assertEqual(s.fragment('/intern(ship)?/'), 'intern(ship)?')

    def test_the_page_round_trips_every_setting_exactly(self):
        values = s.parse(s.render(json.loads(json.dumps(FILES))))
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(s, 'CONFIG', Path(tmp)):
            (Path(tmp) / 'search.json').write_text(json.dumps(FILES['search']))
            (Path(tmp) / 'preferences.json').write_text(json.dumps(FILES['preferences']))
            files = s.apply(values)
        self.assertEqual(files, FILES)  # the page never changes what a search matches

    def test_a_first_format_page_is_upgraded_without_changing_meaning_or_losing_edits(self):
        class Page:
            def __init__(self, text):
                self.text = text

            def page_text(self, page_id):
                return self.text
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(s, 'CONFIG', Path(tmp)):
            for name in ('search', 'preferences'):
                (Path(tmp) / f'{name}.json').write_text(json.dumps(FILES[name]))
            old = s.render(s.load_cached(), show=s.readable_v1, intro='What Job Pilotto looks for.')
            # Untouched: rebuilt from the cache, so "site reliability" still matches anywhere.
            new = s.upgrade(Page(old), 'p')
            self.assertIn('- site reliability', new)
            self.assertIn('- "sre"', new)
            self.assertEqual(s.parse(new), s.parse(s.render(FILES)))
            # Edited (a company added): the edit is kept.
            new = s.upgrade(Page(old.replace('- Acme Corp', '- Acme Corp\n- Initech')), 'p')
            self.assertIn('- Initech', new)
            self.assertEqual(json.loads((Path(tmp) / 'preferences.json').read_text())['excluded_companies'], ['Acme Corp', 'Initech'])
            self.assertIsNone(s.upgrade(Page(new), 'p'))  # current format: nothing to do

    def test_a_missing_heading_keeps_the_cache_and_an_empty_one_means_none(self):
        values = s.parse('## Companies to skip\n## Roles to look for\n- sre\n## Something else\n- ignored')
        self.assertEqual(values, {('preferences', ('excluded_companies',)): [], ('search', ('role_keywords',)): [r'\bsre\b']})


if __name__ == '__main__':
    unittest.main()
