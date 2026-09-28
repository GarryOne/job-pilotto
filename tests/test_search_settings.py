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
    def test_plain_words_where_possible_regex_only_when_needed(self):
        self.assertEqual([s.readable(f) for f in (r'\bsre\b', 'z[uü]rich', 'intern(ship)?', r'\bhr\b business partner')],
                         ['sre', 'zürich', '/intern(ship)?/', 'hr business partner'])

    def test_plain_entries_match_whole_words_any_case_and_accent(self):
        zurich = re.compile(s.fragment('zürich'), re.I)
        self.assertTrue(zurich.search('Zurich, Switzerland') and zurich.search('ZÜRICH'))
        sre = re.compile(s.fragment('sre'), re.I)
        self.assertTrue(sre.search('Senior SRE (m/f)'))
        self.assertFalse(sre.search('Srebrenica office'))
        self.assertEqual(s.fragment('/intern(ship)?/'), 'intern(ship)?')

    def test_the_page_round_trips_every_setting(self):
        values = s.parse(page(s.render(json.loads(json.dumps(FILES)))))
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(s, 'CONFIG', Path(tmp)):
            (Path(tmp) / 'search.json').write_text(json.dumps(FILES['search']))
            (Path(tmp) / 'preferences.json').write_text(json.dumps(FILES['preferences']))
            files = s.apply(values)
        search, prefs = files['search'], files['preferences']
        self.assertEqual(prefs, FILES['preferences'])
        self.assertEqual(search['google_jobs'], FILES['search']['google_jobs'])  # knobs not on the page are kept
        # Matching lists: the same jobs match as before.
        for path, samples in ((('role_keywords',), ['Site Reliability Engineer', 'SRE', 'Platform Engineer II', 'Accountant']),
                              (('locations', 'top_tier'), ['Zürich', 'Zurich', 'Zug', 'Zugspitze']),
                              (('title_exclude_keywords',), ['Junior SRE', 'Internship', 'HR Business Partner', 'Senior SRE'])):
            before = re.compile('|'.join(s._get(FILES['search'], path)), re.I)
            after = re.compile('|'.join(s._get(search, path)), re.I)
            self.assertEqual([bool(before.search(x)) for x in samples], [bool(after.search(x)) for x in samples], path)

    def test_a_missing_heading_keeps_the_cache_and_an_empty_one_means_none(self):
        values = s.parse('## Companies to skip\n## Roles to look for\n- sre\n## Something else\n- ignored')
        self.assertEqual(values, {('preferences', ('excluded_companies',)): [], ('search', ('role_keywords',)): [r'\bsre\b']})


if __name__ == '__main__':
    unittest.main()
