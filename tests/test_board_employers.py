"""The employer of every board job (src/sources/board_employers.py): the posting's hiringOrganization becomes the job's company, also from the
job pages a board's list links to, and the names go to the scout as candidates with their own origin "Board employer"."""
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import scout_candidates  # noqa: E402
from src.ai import page_reader  # noqa: E402
from src.sources import aggregators, board_employers, careers, found_boards  # noqa: E402

SEARCH = {'jobs_board_search_queries': ['fahrer'], 'role_keywords': ['fahrer'],
          'locations': {'top_tier': ['Nürnberg'], 'country_wide': [], 'abroad': []}}
BOARD = {'name': 'Jobbörse', 'host': 'jobs.example', 'search_url': 'https://jobs.example/suche?q={role}&ort={place}', 'countries': ['Germany'], 'kinds': ['any']}


def posting(n, org):
    data = {'@context': 'https://schema.org', '@type': 'JobPosting', 'title': f'Fahrer CE {n}', 'url': f'https://jobs.example/job/{n}00000',
            'jobLocation': {'address': {'addressLocality': 'Nürnberg', 'addressCountry': 'DE'}}}
    if org is not None:
        data['hiringOrganization'] = org
    return f'<html><script type="application/ld+json">{json.dumps(data)}</script><h1>Fahrer CE {n}</h1></html>'


# The list carries no job data, only links: the employer is on each job page (the driver run: 30 jobs, all "via <board>").
LIST = '<html><body>' + ''.join(f'<a href="/job/{n}00000">Fahrer CE {n}</a>' for n in (1, 2, 3, 4)) + '</body></html>'
PAGES = {'https://jobs.example/job/100000': posting(1, {'@type': 'Organization', 'name': 'Spedition Huber GmbH'}),
         'https://jobs.example/job/200000': posting(2, 'Logistik Meier'),
         'https://jobs.example/job/300000': posting(3, [{'name': 'Transport Weiss'}]),
         'https://jobs.example/job/400000': posting(4, None)}


def fetch(url):
    return LIST if 'suche' in url else PAGES[url]


class BoardEmployersTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)
        for patch in (mock.patch('src.paths.DATA', self.dir), mock.patch('src.places.load', return_value={})):
            patch.start()
            self.addCleanup(patch.stop)

    def test_a_job_page_names_its_hiring_organisation_in_any_json_ld_shape(self):
        jobs = careers.jsonld_jobs(PAGES['https://jobs.example/job/300000'], 'https://jobs.example/job/300000')
        self.assertEqual(jobs[0]['employer'], 'Transport Weiss')
        self.assertEqual(careers.jsonld_jobs(PAGES['https://jobs.example/job/400000'], 'https://jobs.example/')[0]['employer'], '')

    def test_board_jobs_get_the_employer_from_their_job_pages_else_the_board_name(self):
        jobs = found_boards.read(SEARCH, [BOARD], fetch=fetch)
        self.assertEqual(sorted((j['title'], j['company']) for j in jobs),
                         [('Fahrer CE 1', 'Spedition Huber GmbH'), ('Fahrer CE 2', 'Logistik Meier'), ('Fahrer CE 3', 'Transport Weiss'),
                          ('Fahrer CE 4', 'via Jobbörse')])

    def test_the_page_reader_keeps_the_employer_a_card_shows(self):
        jobs = page_reader.clean([{'name': 'Fahrer CE', 'place': 'Nürnberg', 'link': '', 'employer': ' Bau  Kraus '}], 'https://jobs.example/suche')
        self.assertEqual(jobs[0]['employer'], 'Bau Kraus')

    def test_employers_of_board_jobs_become_scout_candidates_with_their_own_origin(self):
        found_boards.read(SEARCH, [BOARD], fetch=fetch)
        names = {c['name']: c for c in scout_candidates.board_employer_candidates()}
        self.assertEqual(set(names), {'Spedition Huber GmbH', 'Logistik Meier', 'Transport Weiss'})   # not the board's own name
        self.assertEqual({c['origin'] for c in names.values()}, {'Board employer'})

    def test_harvest_adds_them_once_for_an_it_search_and_for_any_other(self):
        found_boards.read(SEARCH, [BOARD], fetch=fetch)
        for skip in ((), scout_candidates.skipped_origins({'tech_only': True}, False)):
            db = sqlite3.connect(':memory:')
            db.row_factory = sqlite3.Row
            self.assertEqual(scout_candidates.harvest(db, {'excluded': []}, [scout_candidates.board_employer_candidates], skip), 3)
            self.assertEqual(scout_candidates.harvest(db, {'excluded': []}, [scout_candidates.board_employer_candidates], skip), 0)
        for skip in ((), scout_candidates.skipped_origins({'tech_only': True}, False)):
            listed = [getattr(source, 'list_name', '') for source in scout_candidates.default_sources(db, {}, ['Germany'], skip)]
            self.assertIn('board employers', listed)

    def test_every_aggregator_job_with_an_employer_is_noted_not_the_missing_or_placeholder_ones(self):
        board_employers.note([{'company': 'Acme AG', 'source': 'x'}, {'company': 'Unknown employer'}, {'company': 'via Some Board'}, {'company': ''}], 'Arbeitnow')
        self.assertEqual([c['name'] for c in board_employers.candidates()], ['Acme AG'])

    def test_a_job_with_no_employer_is_looked_up_on_its_page_within_a_cap(self):
        jobs = [{'company': 'Unknown employer', 'url': 'https://jobs.example/job/100000'}, {'company': 'Acme', 'url': 'https://jobs.example/job/200000'},
                {'company': 'Unknown employer', 'url': 'https://jobs.example/job/400000'}]
        asked = []
        board_employers.fill_missing(jobs, fetch=lambda url: asked.append(url) or PAGES[url])
        self.assertEqual([j['company'] for j in jobs], ['Spedition Huber GmbH', 'Acme', 'Unknown employer'])
        self.assertEqual(len(asked), 2)
        asked.clear()
        board_employers.fill_missing([{'company': 'Unknown employer', 'url': f'https://jobs.example/job/{n}'} for n in range(50)],
                                     fetch=lambda url: asked.append(url) or PAGES['https://jobs.example/job/400000'])
        self.assertEqual(len(asked), board_employers.MAX_LOOKUPS)

    def test_a_refusing_job_page_is_left_alone(self):
        import urllib.error

        def refuse(url):
            raise urllib.error.HTTPError(url, 403, 'Forbidden', None, None)
        jobs = [{'company': 'Unknown employer', 'url': 'https://jobs.example/job/1'}]
        board_employers.fill_missing(jobs, fetch=refuse)
        self.assertEqual(jobs[0]['company'], 'Unknown employer')

    def test_scan_fills_and_notes_the_employers_of_the_jobs_it_keeps(self):
        db = sqlite3.connect(':memory:')
        job = aggregators._job('x', '1', 'Fahrer CE', None, 'Nürnberg', 'https://jobs.example/job/100000')
        with mock.patch('src.sources.board_employers.fetch', fetch), mock.patch('src.sources.feeds.wanted_title', return_value=True), \
                mock.patch('src.sources.feeds.wanted_location', return_value=True), mock.patch('src.sources.feeds.record', return_value='new'):
            report = aggregators.scan(db, SEARCH, readers=[('Test board', lambda search: [job])])
        self.assertEqual(report['jobs'][0]['company'], 'Spedition Huber GmbH')
        self.assertEqual([c['name'] for c in board_employers.candidates()], ['Spedition Huber GmbH'])


if __name__ == '__main__':
    unittest.main()
