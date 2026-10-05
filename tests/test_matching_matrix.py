"""Does a strategy return the right jobs? A matrix of strategy inputs (places, region words, level, roles, skipped titles) against fixture
postings, with the kept and dropped lists written out. The real config files and the real matcher (src/sources/feeds.py: the same title and
place decisions the crawl makes), no app, no AI, seconds: the same way tests/test_e2e_employers_fixtures.py proves the employers outcomes.
Each scenario runs in its own process, because the matching words are read when feeds.py is imported.

Known gaps are written as expected failures, so they stay visible: when one is fixed the test starts to pass and must be promoted."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

RUN = r'''
import json, sys
sys.path.insert(0, sys.argv[1])
from src.sources import feeds
rows = json.loads(sys.argv[2])
print(json.dumps([[t, l, bool(feeds.wanted_title(t) and feeds.wanted_location({'location': l, 'remote': bool(r)}))] for t, l, r in rows]))
'''

ANALYST = {'role_keywords': ['data analyst']}


def kept(search, postings):
    """The postings (title, location) the crawl would keep for this search; a title alone is placed in Zurich so only the title decides."""
    rows = [(p, 'Zurich, Switzerland', 0) if isinstance(p, str) else (p[0], p[1], p[2] if len(p) > 2 else 0) for p in postings]
    with tempfile.TemporaryDirectory() as tmp:
        shutil.copytree(ROOT / 'config', tmp, dirs_exist_ok=True)
        base = json.loads((ROOT / 'config' / 'search.json').read_text())
        base.update({'role_keywords': ['data analyst'], 'title_exclude_keywords': [], 'remote_excluded_regions': [], 'level': [],
                     'locations': {'top_tier': ['zurich'], 'country_wide': [], 'abroad': []}})
        base.update(search)
        (Path(tmp) / 'search.json').write_text(json.dumps(base))
        env = {k: v for k, v in os.environ.items() if k != 'JOB_PILOTTO_LOCATIONS_FILE'}
        done = subprocess.run([sys.executable, '-c', RUN, str(ROOT), json.dumps(rows)], capture_output=True, text=True, timeout=60,
                              env={**env, 'JOB_PILOTTO_CONFIG_DIR': tmp})
    assert done.returncode == 0, done.stderr
    return [row[0] if row[1] == 'Zurich, Switzerland' and isinstance(postings[i], str) else (row[0], row[1])
            for i, row in enumerate(json.loads(done.stdout.strip().splitlines()[-1])) if row[2]]


def places(top=(), country=(), abroad=()):
    return {'locations': {'top_tier': list(top), 'country_wide': list(country), 'abroad': list(abroad)}}


CITIES = {  # a posting's location is usually a city; the country is rarely in it
    'zurich': ['Zurich', 'Zürich', 'Zurich, Switzerland', 'Zuerich'], 'winterthur': ['Winterthur'], 'dubendorf': ['Dübendorf'],
    'basel': ['Basel', 'Basel, Switzerland'], 'bern': ['Bern', 'Bern, Switzerland'], 'luzern': ['Luzern', 'Lucerne'], 'zug': ['Zug'],
    'geneva': ['Geneva', 'Genève', 'Geneva, Switzerland'], 'lausanne': ['Lausanne'], 'neuchatel': ['Neuchâtel'], 'fribourg': ['Fribourg'],
    'lugano': ['Lugano'], 'bellinzona': ['Bellinzona'], 'stgallen': ['St. Gallen', 'St Gallen'],
}
ELSEWHERE = ['Berlin, Germany', 'Munich, Germany', 'London, UK', 'Paris, France', 'Vienna, Austria', 'Singapore', 'Tokyo, Japan', 'Bangalore, India']


def where(search, locations):
    """Which of these locations a 'Data Analyst' posting is kept in, for this search."""
    return sorted(loc for title, loc in kept(search, [('Data Analyst', loc) for loc in locations]))


class SwitzerlandTest(unittest.TestCase):
    ALL_SWISS = sorted(sum(CITIES.values(), []))

    def test_switzerland_finds_a_posting_whatever_swiss_city_it_names(self):
        for word in ('switzerland', 'Switzerland', 'schweiz', 'suisse', '"switzerland"'):
            self.assertEqual(where(places(country=[word]), self.ALL_SWISS + ELSEWHERE), self.ALL_SWISS, word)

    def test_a_country_written_as_an_exact_word_still_matches_the_country_in_the_text(self):
        self.assertEqual(where(places(country=['switzerland']), ['Remote, Switzerland', 'Home office (Switzerland)', 'Berlin, Germany']),
                         ['Home office (Switzerland)', 'Remote, Switzerland'])

    def test_remote_postings_are_kept_unless_their_region_is_one_you_skip(self):
        """By design: 'remote' is a place of its own, open to anyone unless the posting names a region the user cannot work from."""
        remote = ['Remote, Germany', 'Remote - Europe', 'Remote (United States)']
        self.assertEqual(where({**places(country=['switzerland']), 'remote_excluded_regions': []}, remote), sorted(remote))
        self.assertEqual(where({**places(country=['switzerland']), 'remote_excluded_regions': ['united states']}, remote), ['Remote - Europe', 'Remote, Germany'])

    def test_romandie_is_the_french_speaking_part_only(self):
        french = ['Geneva', 'Genève', 'Lausanne', 'Neuchâtel', 'Fribourg']
        for word in ('romandie', 'Romandie', 'suisse romande', 'French-speaking Switzerland'):
            self.assertEqual(where(places(top=[word]), french + ['Zürich', 'Basel', 'Lugano', 'Luzern'] + ELSEWHERE), sorted(french), word)

    def test_deutschschweiz_is_the_german_speaking_part_only(self):
        german = ['Zürich', 'Basel', 'Bern', 'Luzern', 'Zug', 'St. Gallen', 'Winterthur']
        for word in ('deutschschweiz', 'Deutschschweiz', 'German-speaking Switzerland'):
            self.assertEqual(where(places(top=[word]), german + ['Genève', 'Lausanne', 'Lugano'] + ELSEWHERE), sorted(german), word)

    def test_ticino_is_the_italian_speaking_part_only(self):
        for word in ('ticino', 'Tessin', 'Italian-speaking Switzerland'):
            self.assertEqual(where(places(top=[word]), ['Lugano', 'Bellinzona', 'Zürich', 'Genève']), ['Bellinzona', 'Lugano'], word)

    def test_metropolitan_regions(self):
        self.assertEqual(where(places(top=['Greater Zurich']), ['Zürich', 'Winterthur', 'Dübendorf', 'Zug', 'Basel', 'Bern', 'Genève']),
                         ['Dübendorf', 'Winterthur', 'Zug', 'Zürich'])
        self.assertEqual(where(places(top=['Basel region']), ['Basel', 'Liestal', 'Muttenz', 'Zürich']), ['Basel', 'Liestal', 'Muttenz'])
        self.assertEqual(where(places(top=['Lake Geneva']), ['Genève', 'Lausanne', 'Montreux', 'Nyon', 'Zürich']), ['Genève', 'Lausanne', 'Montreux', 'Nyon'])
        self.assertEqual(where(places(top=['Central Switzerland']), ['Luzern', 'Zug', 'Schwyz', 'Zürich']), ['Luzern', 'Schwyz', 'Zug'])

    def test_a_place_typed_without_its_umlaut_finds_the_posting_that_has_it(self):
        self.assertEqual(where(places(top=['zurich']), ['Zürich', 'Zurich', 'Basel']), ['Zurich', 'Zürich'])
        self.assertEqual(where(places(top=['geneva']), ['Genève', 'Geneva', 'Basel']), ['Geneva'])   # Genève is French spelling, not an accent of Geneva
        self.assertEqual(kept({'role_keywords': ['entwickler']}, ['Softwareentwickler', 'Entwickler Frontend']), ['Softwareentwickler', 'Entwickler Frontend'])
        self.assertEqual(kept({'role_keywords': ['sachbearbeiter']}, ['Sachbearbeiterin Buchhaltung (Zürich)']), ['Sachbearbeiterin Buchhaltung (Zürich)'])

    def test_a_city_stays_a_city(self):
        self.assertEqual(where(places(top=['zurich']), ['Zürich', 'Zurich', 'Winterthur', 'Basel', 'Lausanne']), ['Zurich', 'Zürich'])
        self.assertEqual(where(places(top=['basel']), ['Basel', 'Liestal', 'Zürich']), ['Basel'])

    def test_region_words_written_the_way_the_notion_page_stores_them(self):
        from src.notion import search_settings as page
        for entry in ('Romandie', 'romandie', '"romandie"', 'Suisse romande'):
            fragment = page.fragment_of(entry)
            self.assertEqual(where(places(top=[fragment]), ['Lausanne', 'Zürich']), ['Lausanne'], entry)
        self.assertEqual(where(places(top=[page.fragment_of('Zürich area')]), ['Winterthur', 'Basel']), ['Winterthur'])

    def test_a_region_plus_a_city_abroad_keeps_both(self):
        self.assertEqual(where(places(top=['romandie'], abroad=['london']), ['Lausanne', 'London, UK', 'Zürich', 'Berlin, Germany']), ['Lausanne', 'London, UK'])

    def test_a_place_that_is_no_region_stays_exactly_as_written(self):
        self.assertEqual(where(places(top=['singapore']), ['Singapore', 'Tokyo, Japan', 'Zürich']), ['Singapore'])

    @unittest.expectedFailure
    def test_GAP_asia_is_a_region_too(self):
        """Today 'Asia' matches only a posting whose location text says Asia. Only Switzerland's regions are known (src/regions.py)."""
        self.assertEqual(where(places(top=['asia']), ['Singapore', 'Tokyo, Japan', 'Bangalore, India', 'Berlin, Germany']), ['Bangalore, India', 'Singapore', 'Tokyo, Japan'])


class LevelTest(unittest.TestCase):
    ROLES = ['Data Analyst', 'Data Analyst (m/w/d)', 'Junior Data Analyst', 'Data Analyst Intern', 'Werkstudent Data Analyst', 'Praktikum Data Analyst',
             'Graduate Data Analyst', 'Senior Data Analyst', 'Sr. Data Analyst', 'Lead Data Analyst', 'Principal Data Analyst', 'Staff Data Analyst',
             'Teamleiter Data Analyst', 'Head of Data Analyst Team']
    PLAIN = ['Data Analyst', 'Data Analyst (m/w/d)']
    JUNIORISH = ['Junior Data Analyst', 'Data Analyst Intern', 'Werkstudent Data Analyst', 'Praktikum Data Analyst', 'Graduate Data Analyst']
    SENIORISH = ['Senior Data Analyst', 'Sr. Data Analyst', 'Lead Data Analyst', 'Principal Data Analyst', 'Staff Data Analyst', 'Teamleiter Data Analyst',
                 'Head of Data Analyst Team']

    def test_without_a_level_every_title_is_kept_as_before(self):
        self.assertEqual(kept({}, self.ROLES), sorted(self.ROLES, key=self.ROLES.index))
        self.assertEqual(kept({'level': ['whatever']}, self.ROLES), self.ROLES, 'an unknown level is ignored')
        self.assertEqual(kept({'level': []}, self.ROLES), self.ROLES)

    def test_junior_skips_the_senior_titles_and_keeps_the_rest(self):
        for level in (['junior'], ['Junior'], 'junior', ['entry-level']):
            self.assertEqual(kept({'level': level}, self.ROLES), self.PLAIN + self.JUNIORISH, level)

    def test_senior_skips_the_entry_level_titles_and_keeps_the_rest(self):
        for level in (['senior'], ['Senior'], 'senior'):
            self.assertEqual(kept({'level': level}, self.ROLES), self.PLAIN + self.SENIORISH, level)

    def test_mid_skips_both_ends_and_keeps_the_unlabelled_titles(self):
        self.assertEqual(kept({'level': ['mid']}, self.ROLES), self.PLAIN)
        self.assertEqual(kept({'level': ['mid-level']}, self.ROLES), self.PLAIN)

    def test_lead_skips_entry_titles_but_keeps_senior_ones(self):
        for level in (['lead'], ['Staff/Principal'], ['principal']):
            self.assertEqual(kept({'level': level}, self.ROLES), self.PLAIN + self.SENIORISH, level)

    def test_the_users_own_skipped_titles_still_apply_with_a_level(self):
        said = kept({'level': ['junior'], 'title_exclude_keywords': ['werkstudent']}, self.ROLES)
        self.assertEqual(said, self.PLAIN + [t for t in self.JUNIORISH if t != 'Werkstudent Data Analyst'])

    def test_a_level_does_not_drop_roles_whose_title_just_contains_a_level_word(self):
        nurses = {'role_keywords': ['nurse']}
        self.assertEqual(kept({**nurses, 'level': ['junior']}, ['Staff Nurse', 'Registered Nurse', 'Senior Staff Nurse', 'Ward Nurse']),
                         ['Staff Nurse', 'Registered Nurse', 'Ward Nurse'])

    def test_a_region_and_a_level_work_together(self):
        said = kept({**places(country=['switzerland']), 'level': ['junior']},
                    [('Junior Data Analyst', 'Lausanne', 0), ('Senior Data Analyst', 'Lausanne', 0), ('Junior Data Analyst', 'Berlin, Germany', 0), ('Data Analyst', 'Lugano', 0)])
        self.assertEqual(said, [('Junior Data Analyst', 'Lausanne'), ('Data Analyst', 'Lugano')])

    def test_junior_as_a_role_word_only_adds_titles_it_does_not_filter(self):
        """A role keyword 'junior' widens the search (OR); it never removes a senior title: that is what the level setting is for."""
        said = kept({'role_keywords': ['junior', 'data analyst']}, ['Junior Data Analyst', 'Senior Data Analyst'])
        self.assertEqual(said, ['Junior Data Analyst', 'Senior Data Analyst'])


class NotionRoundTripTest(unittest.TestCase):
    def test_the_level_and_the_region_words_survive_the_settings_page(self):
        from src.notion import search_settings as page
        files = {'search': {'level': ['senior'], 'locations': {'top_tier': ['romandie'], 'country_wide': ['switzerland'], 'abroad': []}, 'role_keywords': ['data analyst']},
                 'preferences': {}}
        text = page.render(files)
        self.assertIn('## Your level\n- senior', text)
        values = page.parse(text)
        self.assertEqual(values[('search', ('level',))], ['senior'])
        self.assertEqual(values[('search', ('locations', 'top_tier'))], ['romandie'])

    def test_a_page_written_before_levels_keeps_the_cached_level(self):
        from src.notion import search_settings as page
        old_page = '## Roles to look for\n- data analyst\n'
        self.assertNotIn(('search', ('level',)), page.parse(old_page))   # a missing heading is not "no level": the cached value stays


if __name__ == '__main__':
    unittest.main()
