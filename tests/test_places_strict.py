"""Only the user's places (7 Oct 2026: a Geneva/Lausanne search that also said "Switzerland" listed 1,335 jobs, 32 of them in Geneva or
Lausanne): no hard-coded Swiss match, remote jobs placed elsewhere left out, jobs.ch postings keep their town, jobs outside the places
closed, and the Jobs list says what it left out."""
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src import desktop, regions, store
from src.paths import keyword_regex
from src.sources import aggregators, ats, feeds

ROMANDIE = keyword_regex(regions.expand(['geneva', 'lausanne', 'Romandie']))


class PlacesTests(unittest.TestCase):
    def test_a_romandie_search_takes_romandie_only(self):
        with mock.patch.object(feeds, 'PLACE', ROMANDIE):
            for where in ('Vevey', 'Lausanne, St-Laurent, Vaud, CH', 'Genève', 'Sion, Valais', 'Fribourg'):
                self.assertTrue(feeds.wanted_location({'location': where}), where)
            for where in ('St. Gallen, CH', 'Zürich, Switzerland', 'Switzerland', 'Basel, CH', 'Dubai, UAE'):
                self.assertFalse(feeds.wanted_location({'location': where}), where)

    def test_a_remote_job_placed_elsewhere_is_left_out(self):
        with mock.patch.object(feeds, 'PLACE', ROMANDIE):
            for where in ('London', 'Philippines; Singapore', 'Singapore'):
                self.assertFalse(feeds.wanted_location({'location': where, 'remote': True}), where)
            for where in ('Remote', 'Remote, Europe', 'Anywhere', '', 'Remote (EMEA)'):
                self.assertTrue(feeds.wanted_location({'location': where, 'remote': True}), where)
            self.assertTrue(feeds.wanted_location({'location': 'Lausanne', 'remote': True}))


    def test_no_remote_jobs_when_the_settings_say_no(self):
        self.assertFalse(feeds.remote_wanted({'remote_jobs': ['No']}))
        self.assertTrue(feeds.remote_wanted({'remote_jobs': ['Yes']}))
        self.assertTrue(feeds.remote_wanted({}), 'a page without the heading keeps remote jobs')
        with mock.patch.object(feeds, 'PLACE', ROMANDIE), mock.patch.object(feeds, 'REMOTE_WANTED', False):
            for where in ('Remote', 'Remote, Europe', 'Anywhere'):
                self.assertFalse(feeds.wanted_location({'location': where, 'remote': True}), where)
            self.assertTrue(feeds.wanted_location({'location': 'Lausanne (hybrid, remote 2 days)', 'remote': True}), 'in your places')

    def test_the_settings_page_reads_remote_jobs(self):
        from src.notion import search_settings
        values = search_settings.parse('Format 2\n## Remote jobs\n- No\n')
        self.assertEqual(values[('search', ('remote_jobs',))], ['No'])


class ClosedOutsideTests(unittest.TestCase):
    def test_jobs_outside_the_places_close_and_the_ones_you_touched_stay(self):
        with tempfile.TemporaryDirectory() as tmp, store.connect(Path(tmp) / 'jobs.sqlite') as db:
            ids = {}
            for name, where, notes in [('vevey', 'Vevey', ''), ('gallen', 'St. Gallen, CH', ''), ('applied', 'Zürich', ''),
                                       ('mine', 'Basel', 'imported'), ('blank', '', '')]:
                ids[name], _ = store.upsert_job(db, {'title': 'Vendeur', 'company': 'Coop', 'url': f'https://x.ch/{name}', 'location': where,
                                                    'notes': notes or None}, 'Coop')
            store.set_application_status(db, ids['applied'], 'applied')
            db.commit()
            with mock.patch.object(feeds, 'PLACE', ROMANDIE):
                self.assertEqual(store.close_elsewhere(db, feeds.wanted_location), 1)
            states = {name: db.execute('SELECT state FROM jobs WHERE id = ?', (job_id,)).fetchone()[0] for name, job_id in ids.items()}
            self.assertEqual(states, {'vevey': 'open', 'gallen': 'closed', 'applied': 'open', 'mine': 'open', 'blank': 'open'})


def jobsch_page(job_id, town):
    """A jobs.ch search page as it is: the schema.org posting names only the country, the page's app data has the town."""
    posting = {'@type': 'JobPosting', 'title': 'Collaborateur Magasin', 'url': f'https://www.jobs.ch/en/vacancies/detail/{job_id}/',
               'hiringOrganization': {'name': 'FNAC (Suisse) SA', 'sameAs': 'https://www.jobs.ch/en/companies/4259-4259-fnac-suisse-sa/'},
               'jobLocation': {'@type': 'Place', 'address': {'@type': 'PostalAddress', 'addressCountry': 'CH'}}}
    state = {'id': job_id, 'isActive': True, 'locations': [], 'logo': None, 'place': town, 'publicationDate': '2026-08-21'}
    return ('<script type="application/ld+json">' + json.dumps({'@graph': [posting]}) + '</script>'
            '<script id="__INIT__">' + json.dumps({'jobs': [state]}, separators=(',', ':')) + '</script>')


class JobsChTownTests(unittest.TestCase):
    ID = '2a71593d-071c-4e8e-a9b0-317f81a9bef6'

    def test_the_town_comes_from_the_page_when_the_listing_names_only_the_country(self):
        self.assertEqual(ats.jobsch_towns(jobsch_page(self.ID, 'Vevey')), {self.ID: 'Vevey'})
        with mock.patch.object(ats, '_get', lambda url: jobsch_page(self.ID, 'Vevey').encode()):
            jobs = ats.jobsch('4259-fnac-suisse-sa')
        self.assertEqual([j['location'] for j in jobs], ['Vevey, Switzerland'])

    def test_the_board_search_keeps_the_town_too(self):
        search = {'locations': {'top_tier': ['geneva'], 'country_wide': [], 'abroad': []}, 'jobs_board_search_queries': ['vendeur'],
                  'board_discovery_keywords': ['vendeur'], 'role_keywords': ['vendeur']}
        jobs = aggregators.jobsch(search, get=lambda url: jobsch_page(self.ID, 'Vevey'))
        self.assertEqual({j['location'] for j in jobs}, {'Vevey, Switzerland'})


class CutListTests(unittest.TestCase):
    def test_the_list_sends_the_best_rows_and_counts_the_new_ones_it_left_out(self):
        today = __import__('datetime').date.today().isoformat()
        rows = [{'url': f'https://x/{i}', 'title': 'Vendeur', 'company': 'Coop', 'location': 'Genève', 'work_mode': '', 'fit': 90 - i,
                 'reason': '', 'match_status': 'Open', 'first_seen': today if i % 2 else '2026-01-01'} for i in range(10)]
        with mock.patch.object(desktop.digest, 'eligible_jobs', return_value=([], [])), mock.patch.object(desktop.score, 'load', return_value={}):
            result = desktop.jobs(sqlite3.connect(':memory:'), limit=4, notion_jobs=rows)
        self.assertEqual((len(result['jobs']), result['total']), (4, 10))
        self.assertEqual(result['week_beyond'], 3, 'rows 5, 7 and 9 are new and not sent')
        self.assertEqual(result['review_beyond'], 6, 'the Jobs badge counts the 6 unsent jobs to review')


if __name__ == '__main__':
    unittest.main()
