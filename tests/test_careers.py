"""Employers with no job-system feed (src/sources/careers.py), the extra job systems, and the Swiss catalogs the scout reads."""
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import scout  # noqa: E402
from src.sources import ats, careers, render  # noqa: E402

POSTING = {'@context': 'https://schema.org', '@type': 'JobPosting', 'title': 'Site Reliability Engineer', 'datePosted': '2026-10-01',
           'description': '<p>Run our <b>Kubernetes</b> platform.</p>', 'url': '/jobs/sre-1',
           'jobLocation': {'@type': 'Place', 'address': {'addressLocality': 'Zürich', 'addressCountry': 'CH'}},
           'baseSalary': {'currency': 'CHF', 'value': {'minValue': 120000, 'maxValue': 150000}}}


def page(*postings, body=''):
    blocks = ''.join(f'<script type="application/ld+json">{json.dumps(p)}</script>' for p in postings)
    return f'<html><body>{body}{blocks}</body></html>'


def site(pages):
    """A fetch function over a dict of address -> html (anything else fails like an unreachable page)."""
    def fetch(url):
        if url not in pages:
            raise OSError(f'no page {url}')
        return pages[url]
    return fetch


class SlugTests(unittest.TestCase):
    def test_an_address_travels_as_a_word_character_slug_and_back(self):
        slug = careers.encode('https://www.acme.ch/en/careers?x=1')
        self.assertEqual(slug, 'www.acme.ch__en__careers')
        self.assertEqual(careers.decode(slug), 'https://www.acme.ch/en/careers')
        self.assertEqual(careers.decode(careers.encode('https://acme.ch')), 'https://acme.ch/')
        with self.assertRaises(ValueError):
            careers.encode('https://acme.ch/' + 'a' * 200)
        with self.assertRaises(ValueError):
            careers.decode('x/../etc')


class ReadingTests(unittest.TestCase):
    def test_job_data_on_a_page_becomes_jobs_with_place_salary_and_plain_text(self):
        job, = careers.jsonld_jobs(page(POSTING), 'https://acme.ch/careers')
        self.assertEqual((job['title'], job['location'], job['date_posted'], job['url']),
                         ('Site Reliability Engineer', 'Zürich, Switzerland', '2026-10-01', 'https://acme.ch/jobs/sre-1'))
        self.assertEqual((job['description'], job['salary']), ('Run our Kubernetes platform.', 'CHF 120000–150000'))

    def test_postings_inside_a_graph_and_bad_json_are_handled(self):
        markup = page({'@graph': [{'@type': 'WebSite'}, POSTING]}) + '<script type="application/ld+json">{broken</script>'
        self.assertEqual(len(careers.jsonld_jobs(markup, 'https://acme.ch/')), 1)

    def test_a_listing_without_data_is_read_through_its_job_pages(self):
        listing = '<a href="/jobs/sre-1">SRE</a><a href="/about">About</a><a href="/jobs/dev-2">Dev</a>'
        pages = {'https://acme.ch/careers': listing, 'https://acme.ch/jobs/sre-1': page(POSTING),
                 'https://acme.ch/jobs/dev-2': page({**POSTING, 'title': 'Developer', 'url': '/jobs/dev-2'})}
        jobs = careers.read_page('https://acme.ch/careers', site(pages))
        self.assertEqual(sorted(j['title'] for j in jobs), ['Developer', 'Site Reliability Engineer'])

    def test_a_job_system_embedded_in_a_page_is_recognised(self):
        self.assertEqual(careers.embedded_system('<iframe src="https://boards.greenhouse.io/embed/job_board?for=acme"></iframe>'), ('greenhouse', 'acme'))
        self.assertEqual(careers.embedded_system('<a href="https://acme.teamtailor.com/jobs">Jobs</a>'), ('teamtailor', 'acme'))
        self.assertIsNone(careers.embedded_system('<a href="https://example.org">x</a>'))

    def test_only_public_addresses_are_fetched(self):
        for bad in ('http://127.0.0.1/', 'http://localhost/x', 'file:///etc/passwd', 'ftp://acme.ch/'):
            with self.assertRaises(ValueError):
                careers.get_text(bad)


class DiscoverTests(unittest.TestCase):
    def test_home_page_to_careers_page_with_job_data(self):
        pages = {'https://acme.ch': '<a href="/en/careers">Careers</a><a href="/contact">Contact</a>',
                 'https://acme.ch/en/careers': page(POSTING)}
        found = careers.discover('acme.ch', site(pages))
        self.assertEqual((found['ats'], found['slug'], len(found['jobs'])), ('careers', 'acme.ch__en__careers', 1))

    def test_an_embedded_job_system_wins_over_reading_the_page(self):
        pages = {'https://acme.ch': '<a href="/karriere">Karriere</a>', 'https://acme.ch/karriere': '<iframe src="https://join.com/companies/acme-ag"></iframe>'}
        self.assertEqual(careers.discover('https://acme.ch', site(pages)), {'ats': 'join', 'slug': 'acme-ag'})

    def test_a_job_board_is_not_an_employer_site_and_one_job_page_is_not_a_list(self):
        pages = {'https://www.xing.com/jobs': '<a href="/jobs/x">Jobs</a>', 'https://acme.ch': '<a href="/jobs/sre-1">Jobs</a>', 'https://acme.ch/jobs/sre-1': page(POSTING)}
        self.assertIsNone(careers.discover('https://www.xing.com/jobs', site(pages)))
        self.assertIsNone(careers.discover('https://acme.ch', site(pages)))
        self.assertTrue(careers.own_site('acme.ch') and not careers.own_site('https://swissdevjobs.ch') and not careers.own_site('https://de.linkedin.com/company/x'))

    def test_a_widget_on_the_home_page_is_not_the_companys_job_system(self):
        pages = {'https://acme.ch': '<a href="https://other.recruitee.com">partner</a><a href="/karriere">Karriere</a>', 'https://acme.ch/karriere': '<p>Arbeiten bei uns</p>'}
        self.assertIsNone(careers.discover('https://acme.ch', site(pages)))

    def test_a_site_that_refuses_or_has_no_jobs_is_simply_not_found(self):
        self.assertIsNone(careers.discover('acme.ch', site({})))
        self.assertIsNone(careers.discover('acme.ch', site({'https://acme.ch': '<a href="/jobs">Jobs</a>', 'https://acme.ch/jobs': '<p>Join us</p>'})))
        self.assertIsNone(careers.discover('', site({})))


class SystemsTests(unittest.TestCase):
    def test_addresses_reveal_the_new_systems(self):
        self.assertEqual(ats.detect('https://acme.wd3.myworkdayjobs.com/en-US/Careers/job/x'), ('workday', 'acme.wd3.Careers'))
        self.assertEqual(ats.detect('https://join.com/companies/acme-ag/123-sre'), ('join', 'acme-ag'))
        self.assertEqual(ats.detect('https://acme.teamtailor.com/jobs/1'), ('teamtailor', 'acme'))
        self.assertIsNone(ats.detect('https://career.teamtailor.com/jobs'))   # the vendor's own site, not a customer

    def test_slugs_are_guessed_from_the_web_address(self):
        self.assertEqual(ats.domain_guesses('https://www.acme-tech.ch/en'), ['acme-tech', 'acmetech', 'acme-tech-ch'])
        self.assertEqual(ats.domain_guesses('acme.co.uk'), ['acme', 'acme-uk'])
        self.assertEqual(ats.domain_guesses(''), [])

    def test_teamtailor_feed_is_read_with_places(self):
        feed = b'''<rss xmlns:tt="https://teamtailor.com/locations"><channel><item><title>SRE</title><guid>1</guid><link>https://a.teamtailor.com/jobs/1</link>
            <pubDate>Mon, 01 Oct 2026</pubDate><description>&lt;p&gt;Hi&lt;/p&gt;</description><remoteStatus>hybrid</remoteStatus>
            <tt:locations><tt:location><tt:city>Zurich</tt:city><tt:country>Switzerland</tt:country></tt:location></tt:locations></item></channel></rss>'''
        with mock.patch.object(ats, '_get', return_value=feed):
            job, = ats.teamtailor('a')
        self.assertEqual((job['title'], job['location'], job['remote'], job['description']), ('SRE', 'Zurich, Switzerland', True, 'Hi'))

    def test_workday_slug_must_be_three_safe_parts(self):
        self.assertEqual(ats._split_workday('nvidia.wd5.NVIDIAExternalCareerSite'), ('nvidia', 'wd5', 'NVIDIAExternalCareerSite'))
        for bad in ('nvidia', 'a.b.c', 'a.wd5.x/../y'):
            with self.assertRaises(ValueError):
                ats._split_workday(bad)

    def test_the_new_systems_can_be_probed_by_a_scout(self):
        for system in ('teamtailor', 'join', 'workday', 'careers'):
            self.assertIn(system, ats.FETCHERS)
            self.assertEqual(scout.board_url(system, 'acme.wd3.Careers' if system == 'workday' else 'www.acme.ch__jobs' if system == 'careers' else 'acme').split('//')[0], 'https:')


class CatalogTests(unittest.TestCase):
    def test_swissdevjobs_employers_come_with_their_website_first_in_the_queue(self):
        listing = [{'company': 'Acme AG', 'companyWebsiteLink': 'acme.ch'}, {'company': 'Acme AG', 'companyWebsiteLink': 'acme.ch'}, {'company': '', 'companyWebsiteLink': 'x.ch'}]
        found = list(scout.swissdevjobs_candidates(get=lambda url: listing))
        self.assertEqual([(c['name'], c['website'], c['priority']) for c in found], [('Acme AG', 'https://acme.ch', 88)])

    def test_wikidata_companies_are_ranked_by_size(self):
        rows = {'results': {'bindings': [{'label': {'value': 'Big AG'}, 'site': {'value': 'https://big.ch'}, 'employees': {'value': '900.0'}},
                                         {'label': {'value': 'Mid AG'}, 'site': {'value': 'https://mid.ch'}, 'employees': {'value': '45'}}]}}
        found = list(scout.wikidata_candidates(get=lambda url: rows))
        self.assertEqual([(c['name'], c['priority']) for c in found], [('Big AG', 60), ('Mid AG', 50)])
        self.assertIn('wd:Q39', scout.WIKIDATA_QUERY)

    def test_harvest_keeps_the_website_and_upgrades_an_older_table(self):
        db = sqlite3.connect(':memory:')
        db.row_factory = sqlite3.Row
        db.execute('CREATE TABLE scout_candidates (key TEXT PRIMARY KEY, name TEXT NOT NULL, origin TEXT NOT NULL, priority INTEGER NOT NULL, '
                   "tier TEXT NOT NULL DEFAULT 'Standard', ats TEXT, slug TEXT, careers TEXT, status TEXT NOT NULL DEFAULT 'pending', quality INTEGER, "
                   'stats_json TEXT, added_at TEXT NOT NULL, checked_at TEXT, next_check TEXT)')
        db.execute("INSERT INTO scout_candidates (key, name, origin, priority, added_at) VALUES ('acme', 'Acme', 'Hacker News', 60, 'x')")
        scout.harvest(db, {'excluded': []}, [lambda: [dict(name='Acme', origin='SwissDevJobs employer', priority=88, website='https://acme.ch'),
                                                       dict(name='Beta AG', origin='SwissDevJobs employer', priority=88, website='https://beta.ch')]])
        rows = {r['name']: r['website'] for r in db.execute('SELECT name, website FROM scout_candidates')}
        self.assertEqual(rows, {'Acme': 'https://acme.ch', 'Beta AG': 'https://beta.ch'})   # the known name learns its address; the new one is added


class FindFeedTests(unittest.TestCase):
    JOBS = [{'title': 'SRE'}]

    def test_a_slug_from_the_domain_is_tried_before_the_website_is_read(self):
        tried = []

        def probe(system, slug):
            tried.append((system, slug))
            return self.JOBS if (system, slug) == ('lever', 'acme-tech') else None
        found = scout.find_feed({'name': 'Totally Different AG', 'website': 'https://www.acme-tech.ch'}, probe, discover=lambda site: self.fail('not needed'))
        self.assertEqual(found, ('lever', 'acme-tech', self.JOBS))

    def test_with_a_website_the_first_word_of_the_name_is_not_guessed(self):
        tried = []
        scout.find_feed({'name': 'Data Purpose AG', 'website': 'https://dp.example'}, lambda system, slug: tried.append(slug), discover=lambda site: None)
        self.assertNotIn('data', tried)
        self.assertIn('datapurpose', tried)
        tried.clear()
        scout.find_feed({'name': 'Data Purpose AG'}, lambda system, slug: tried.append(slug), discover=lambda site: None)
        self.assertIn('data', tried)   # without an address the name is all there is

    def test_a_guessed_feed_must_belong_to_the_company(self):
        other = [{'title': 'Engineer', 'location': 'Remote', 'url': 'https://jobs.x/stellar/1', 'description': 'Stellar Development Foundation'}]
        mine = [{'title': 'Engineer', 'location': 'Zürich', 'url': 'https://jobs.x/p/1', 'description': 'Puzzle ITC builds platforms'}]
        probe = lambda feed: (lambda system, slug: feed if (system, slug) == ('lever', 'puzzle') else None)
        # first word only, and the jobs do not name the rest of the name: someone else's feed
        self.assertIsNone(scout.find_feed({'name': 'Puzzle ITC'}, probe(other), discover=lambda site: None))
        # same guess, jobs that do name it: accepted
        self.assertEqual(scout.find_feed({'name': 'Puzzle ITC'}, probe(mine), discover=lambda site: None)[:2], ('lever', 'puzzle'))
        # the whole name as the slug needs no confirmation
        self.assertEqual(scout.find_feed({'name': 'Sentry'}, lambda s, g: other if (s, g) == ('lever', 'sentry') else None, discover=lambda site: None)[:2], ('lever', 'sentry'))

    def test_the_website_is_read_when_no_guess_works(self):
        found = scout.find_feed({'name': 'Acme AG', 'website': 'https://acme.ch'}, lambda system, slug: None,
                                discover=lambda site: {'ats': 'careers', 'slug': 'acme.ch__jobs', 'jobs': self.JOBS})
        self.assertEqual(found, ('careers', 'acme.ch__jobs', self.JOBS))

    def test_an_embedded_system_found_on_the_site_is_probed_for_its_jobs(self):
        found = scout.find_feed({'name': 'Acme AG', 'website': 'https://acme.ch'},
                                lambda system, slug: self.JOBS if (system, slug) == ('join', 'acme-ag') else None,
                                discover=lambda site: {'ats': 'join', 'slug': 'acme-ag'})
        self.assertEqual(found, ('join', 'acme-ag', self.JOBS))

    def test_nothing_found_is_none_and_a_candidate_without_website_never_reads_a_site(self):
        self.assertIsNone(scout.find_feed({'name': 'Acme AG', 'website': 'https://acme.ch'}, lambda s, g: None, discover=lambda site: None))
        self.assertIsNone(scout.find_feed({'name': 'Acme AG'}, lambda s, g: None, discover=lambda site: self.fail('no website')))


if __name__ == '__main__':
    unittest.main()


class ReaderTests(unittest.TestCase):
    """The AI reader takes over only where the rules found nothing that looks like a role you look for (fake reader, no model)."""

    def setUp(self):
        self.saved = careers.READER
        self.calls = []

    def tearDown(self):
        careers.READER = self.saved

    def reader(self, answer):
        def read(url, markup):
            self.calls.append(url)
            return answer
        careers.READER = read

    PAGES = {'https://acme.ch': '<a href="/jobs">Offene Stellen</a>',
             'https://acme.ch/jobs': '<h1>Jobs</h1><a href="/jobs/about">About us</a><p>We hire a Site Reliability Engineer</p>',
             'https://acme.ch/jobs/about': '<h1>About us</h1><p>We are a company</p>'}

    def test_menu_entries_are_replaced_by_what_the_reader_finds(self):
        self.reader([ats._job('https://acme.ch/jobs#1', 'Site Reliability Engineer', 'Zürich', 'https://acme.ch/jobs')])
        found = careers.discover('acme.ch', site(self.PAGES))
        self.assertEqual([j['title'] for j in found['jobs']], ['Site Reliability Engineer'])
        self.assertEqual(self.calls, ['https://acme.ch/jobs'])

    def test_a_reader_that_was_not_asked_leaves_the_rules_result(self):
        self.reader(None)
        found = careers.discover('acme.ch', site(self.PAGES))
        self.assertEqual([j['title'] for j in found['jobs']], ['About us'])

    def test_a_reader_that_finds_no_jobs_means_no_feed(self):
        self.reader([])
        self.assertIsNone(careers.discover('acme.ch', site(self.PAGES)))

    def test_no_reader_no_change(self):
        careers.READER = None
        self.assertEqual(len(careers.discover('acme.ch', site(self.PAGES))['jobs']), 1)


class ShellTests(unittest.TestCase):
    """A careers page that is an empty frame is read again through the browser; one that is not is never sent there."""

    def setUp(self):
        self.saved = (careers.RENDER, careers.READER)
        careers.READER = None

    def tearDown(self):
        careers.RENDER, careers.READER = self.saved

    def test_an_empty_frame_is_rendered_and_its_jobs_read(self):
        shown = []

        def show(url):
            shown.append(url)
            return page(POSTING)
        careers.RENDER = show
        pages = {'https://acme.ch': '<a href="/jobs">Jobs</a>', 'https://acme.ch/jobs': '<div id="root"></div><script src="app.js"></script>'}
        with mock.patch.object(careers, 'get_text', site(pages)):
            found = careers.discover('acme.ch', careers.get_text)
        self.assertEqual((found['ats'], len(found['jobs'])), ('careers', 1))
        self.assertEqual(shown, ['https://acme.ch/jobs'], 'only the shell page goes to the browser, not the home page')

    def test_a_page_with_text_never_goes_to_the_browser(self):
        careers.RENDER = lambda url: self.fail('not a shell')
        pages = {'https://acme.ch': '<a href="/jobs">Jobs</a>', 'https://acme.ch/jobs': '<p>' + 'Wir arbeiten gern zusammen. ' * 40 + '</p>'}
        with mock.patch.object(careers, 'get_text', site(pages)):
            self.assertIsNone(careers.discover('acme.ch', careers.get_text))

    def test_a_refusing_browser_leaves_the_page_unread(self):
        def refuse(url):
            raise render.Refused('HTTP 403')
        careers.RENDER = refuse
        pages = {'https://acme.ch': '<a href="/jobs">Jobs</a>', 'https://acme.ch/jobs': '<div id="root"></div>'}
        with mock.patch.object(careers, 'get_text', site(pages)):
            self.assertIsNone(careers.discover('acme.ch', careers.get_text))


class ReadMoreSitesTests(unittest.TestCase):
    """Batch A: a careers page found through the site map or a usual address, an empty careers page watched, Umantis read."""

    def setUp(self):
        saved = careers.READER, careers.RENDER
        careers.READER = careers.RENDER = None
        self.addCleanup(lambda: (setattr(careers, 'READER', saved[0]), setattr(careers, 'RENDER', saved[1])))

    def test_a_home_page_without_a_careers_link_is_helped_by_the_site_map(self):
        pages = {'https://acme.ch': '<p>Welcome</p>',
                 'https://acme.ch/sitemap.xml': '<urlset><url><loc>https://acme.ch/about</loc></url><url><loc>https://acme.ch/ueber-uns/offene-stellen</loc></url></urlset>',
                 'https://acme.ch/ueber-uns/offene-stellen': page(POSTING)}
        found = careers.discover('acme.ch', site(pages))
        self.assertEqual((found['ats'], found['slug']), ('careers', 'acme.ch__ueber-uns__offene-stellen'))

    def test_a_site_map_index_and_the_usual_addresses_are_tried(self):
        pages = {'https://acme.ch': '<p>Welcome</p>', 'https://acme.ch/sitemap.xml': '<sitemapindex><sitemap><loc>https://acme.ch/page-sitemap.xml</loc></sitemap></sitemapindex>',
                 'https://acme.ch/page-sitemap.xml': '<urlset><url><loc>https://acme.ch/news</loc></url></urlset>', 'https://acme.ch/jobs': page(POSTING)}
        self.assertEqual(careers.discover('acme.ch', site(pages))['slug'], 'acme.ch__jobs')
        self.assertEqual(careers.guessed_links('https://acme.ch', site({}))[:3], ['https://acme.ch/karriere', 'https://acme.ch/jobs', 'https://acme.ch/careers'])

    def test_a_careers_page_with_no_open_jobs_is_watched_in_any_language(self):
        for text in ('Zurzeit keine offenen Stellen.', 'There are no open positions at the moment.', "Aucun poste ouvert pour l'instant."):
            pages = {'https://acme.ch': '<a href="/karriere">Karriere</a>', 'https://acme.ch/karriere': f'<p>{text}</p>'}
            found = careers.discover('acme.ch', site(pages))
            self.assertEqual((found['slug'], found['jobs'], found['empty']), ('acme.ch__karriere', [], True), text)

    def test_a_watched_page_ends_as_watch_in_the_scout_and_comes_back_in_a_week(self):
        import sqlite3
        from datetime import datetime
        db = sqlite3.connect(':memory:')
        db.row_factory = sqlite3.Row
        with mock.patch.object(scout, 'find_feed', return_value=('careers', 'acme.ch__karriere', [])):
            summary, results = scout.run(db, batch=5, tracker=None, seeds={'excluded': []}, static=[], probe=lambda s, g: None,
                                         harvest_sources=[lambda: [dict(name='Acme AG', origin='x', priority=50, website='https://acme.ch')]])
        row = db.execute('SELECT status, ats, slug, checked_at, next_check FROM scout_candidates').fetchone()
        self.assertEqual((row['status'], row['ats'], row['slug']), ('watch', 'careers', 'acme.ch__karriere'))
        days = (datetime.fromisoformat(row['next_check']) - datetime.fromisoformat(row['checked_at'])).days
        self.assertEqual(days, 7)
        self.assertIn('no open jobs today (watched weekly)', scout.telegram_summary(summary, results))

    def test_umantis_list_and_job_pages_are_read(self):
        listing = (b'<a href="/Vacancies/1092/Description/1" class="HSTableLinkSubTitle" aria-label="DevOps Engineer" id="x">DevOps Engineer</a>'
                   b'<a href="/Vacancies/1092/Description/1" aria-label="DevOps Engineer">again</a>')
        detail = '<h1>DevOps Engineer</h1><p>Arbeitsort: Zürich. Kubernetes und Terraform.</p>'.encode()
        with mock.patch.object(ats, '_get', side_effect=lambda url: listing if url.endswith('/Jobs/All') else detail):
            job, = ats.umantis('recruitingapp-2824')
        self.assertEqual((job['id'], job['title'], job['url']), ('1092', 'DevOps Engineer', 'https://recruitingapp-2824.umantis.com/Vacancies/1092/Description/1'))
        self.assertIn('Kubernetes', job['description'])
        self.assertEqual(ats.detect('https://recruitingapp-2824.umantis.com/Vacancies/1092/Description/1'), ('umantis', 'recruitingapp-2824'))
        with self.assertRaises(ValueError):
            ats.umantis('evil.example/x')

    def test_swiss_job_portals_built_by_scripts_count_as_careers_links(self):
        home = '<a href="https://app.jobportal.abaservices.ch/job-overview/x/de">Offene Stellen</a><a href="https://direktlink.prospective.ch/?view=1">Jobs</a>'
        self.assertEqual(len(careers.careers_links(home, 'https://acme.ch')), 2)
