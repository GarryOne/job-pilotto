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
from src.sources import boards, aggregators, ats, feeds

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
                                       ('mine', 'Basel', 'imported'), ('blank', '', ''), ('saved', 'Bern', ''), ('talking', 'Luzern', '')]:
                ids[name], _ = store.upsert_job(db, {'title': 'Vendeur', 'company': 'Coop', 'url': f'https://x.ch/{name}', 'location': where,
                                                    'notes': notes or None}, 'Coop')
            store.set_application_status(db, ids['applied'], 'applied')
            store.set_application_status(db, ids['saved'], 'saved')   # saved or a kit prepared: not applied yet, so it goes
            store.set_application_status(db, ids['talking'], 'interview')
            db.commit()
            with mock.patch.object(feeds, 'PLACE', ROMANDIE):
                self.assertEqual(store.close_elsewhere(db, feeds.wanted_location), 2)
            states = {name: db.execute('SELECT state FROM jobs WHERE id = ?', (job_id,)).fetchone()[0] for name, job_id in ids.items()}
            self.assertEqual(states, {'vevey': 'open', 'gallen': 'unmatched', 'applied': 'open', 'mine': 'open', 'blank': 'open',
                                      'saved': 'unmatched', 'talking': 'open'})


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

    def test_a_posting_with_an_address_block_and_capitals(self):
        # 7 Oct 2026, a real jobs.ch page: listingTags and an address block sit between the id and the posting's own place; 15 of 20 missed.
        state = ('{"id":"608e1edf-6066-4019-870e-509b373b9369","isActive":true,"listingTags":[{"name":"quickApply"}],"locations":[{"cantonCode":"VD",'
                 '"city":"SAINT SULPICE","place":null}],"place":"SAINT SULPICE","title":"VENDEUR"},'
                 '{"id":"f54105db-c638-4972-81a7-779e99399dd1","locations":[{"city":"Lausanne","place":null}],"place":null,"title":"Vendeur"}')
        self.assertEqual(ats.jobsch_towns(state), {'608e1edf-6066-4019-870e-509b373b9369': 'Saint Sulpice',
                                                   'f54105db-c638-4972-81a7-779e99399dd1': 'Lausanne'})

    def test_an_escaped_place_is_decoded(self):
        # 8 Oct 2026: the page's script data writes "/" as \u002F; "Biel\u002FSolothurn\u002FLangenthal" was stored and shown as is.
        state = '{"id":"%s","place":"Biel\\u002FSolothurn\\u002FLangenthal"}' % self.ID
        self.assertEqual(ats.jobsch_towns(state), {self.ID: 'Biel/Solothurn/Langenthal'})

    def test_every_jobsch_reader_keeps_the_town(self):
        # 8 Oct 2026: the refresh's employer discovery (boards.parse_jobs) saved Manor's Morges jobs as "Switzerland" while the other two readers
        # had the town: held back from scoring as placeless, yet counted as new. One test over the three readers, so a fourth can't miss it.
        page = jobsch_page(self.ID, 'Morges')
        search = {'locations': {'top_tier': ['geneva'], 'country_wide': [], 'abroad': []}, 'jobs_board_search_queries': ['magasin'],
                  'board_discovery_keywords': ['magasin'], 'role_keywords': ['magasin']}
        url = 'https://www.jobs.ch/en/vacancies/?term=magasin&location=morges&page=1'
        with mock.patch.object(ats, '_get', lambda url: page.encode()):
            readers = {'ats.jobsch': [j['location'] for j in ats.jobsch('4259-fnac-suisse-sa')],
                       'aggregators.jobsch': sorted({j['location'] for j in aggregators.jobsch(search, get=lambda url: page)}),
                       'boards.parse_jobs': [j['location'] for j in boards.parse_jobs(page, url, 'jobs.ch', roles=False)]}
        for reader, places in readers.items():
            self.assertTrue(places and all(p.startswith('Morges') for p in places), f'{reader}: {places}')

    def test_the_board_search_asks_every_page_in_the_same_town(self):
        # The posting loop reused the name `place`: page 2 searched location=<a posting's address>, not the user's town.
        asked = []
        def get(url):
            asked.append(url)
            ids = [f'{n:08x}-0000-4000-8000-000000000000' for n in range(len(asked) * 20, len(asked) * 20 + 20)]
            return ''.join(jobsch_page(i, 'Morges') for i in ids)
        search = {'locations': {'top_tier': ['geneva'], 'country_wide': [], 'abroad': []}, 'jobs_board_search_queries': ['magasin'],
                  'board_discovery_keywords': ['magasin'], 'role_keywords': ['magasin']}
        aggregators.jobsch(search, get=get)
        self.assertGreater(len(asked), 1)
        self.assertTrue(all('location=geneva' in url for url in asked), asked)

    def test_the_board_search_keeps_the_town_too(self):
        search = {'locations': {'top_tier': ['geneva'], 'country_wide': [], 'abroad': []}, 'jobs_board_search_queries': ['vendeur'],
                  'board_discovery_keywords': ['vendeur'], 'role_keywords': ['vendeur']}
        jobs = aggregators.jobsch(search, get=lambda url: jobsch_page(self.ID, 'Vevey'))
        self.assertEqual({j['location'] for j in jobs}, {'Vevey, Switzerland'})


class GoneFromTheListTests(unittest.TestCase):
    def test_a_gone_posting_leaves_the_list_unless_you_applied(self):
        rows = [{'url': f'https://x/{stage or "none"}', 'title': 'Vendeur', 'company': 'Coop', 'location': 'Bern', 'work_mode': '', 'fit': 60,
                 'reason': '', 'match_status': 'Not seen', 'first_seen': '2026-10-01', **({'stage': stage, 'notion_url': 'n'} if stage else {})}
                for stage in ('', 'Saved', 'Kit ready', 'Applied', 'Interviewing')]
        with mock.patch.object(desktop.digest, 'eligible_jobs', return_value=([], [])), mock.patch.object(desktop.score, 'load', return_value={}):
            listed = {row['url'] for row in desktop.jobs(sqlite3.connect(':memory:'), notion_jobs=rows)['jobs']}
        self.assertEqual(listed, {'https://x/Applied', 'https://x/Interviewing'})


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


class CleanupOrderTests(unittest.TestCase):
    def test_jobs_outside_your_places_close_after_every_import(self):
        # 7 Oct 2026: the job boards' report was imported after the cleanup and opened again a Lausanne job stored as "Switzerland".
        source = Path('src/daily_search.py').read_text()
        self.assertGreater(source.index('store.close_elsewhere('), source.index('store.import_company_report('))
