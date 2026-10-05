"""Job systems a careers page names that cannot be read (5 Oct 2026: Ringier's Umantis page gave 0 jobs, Tamedia's Teamtailor feed is on its own domain, and both looked like
"this employer has no jobs"): the Teamtailor custom-domain feed, and the scout saying out loud what it could not read."""
import io
import sqlite3
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import scout  # noqa: E402
from src.sources import ats, careers  # noqa: E402

RSS = b'''<?xml version="1.0"?><rss xmlns:tt="https://teamtailor.com/locations"><channel>
<item><guid>1</guid><title>Fotograf:in</title><link>https://jobs.example.ch/jobs/1</link><pubDate>Mon, 05 Oct 2026 08:00:00 +0000</pubDate><description>Bilder</description>
<tt:locations><tt:location><tt:city>Zurich</tt:city><tt:country>Switzerland</tt:country></tt:location></tt:locations></item></channel></rss>'''


class TeamtailorOwnDomainTests(unittest.TestCase):
    def test_a_company_name_reads_teamtailor_com_and_an_address_reads_its_own_domain(self):
        asked = []
        with mock.patch.object(ats, '_get', lambda url: asked.append(url) or RSS), mock.patch.object(careers, '_public', return_value=True):
            self.assertEqual(ats.teamtailor('acme')[0]['title'], 'Fotograf:in')
            self.assertEqual(ats.teamtailor('jobs.example.ch')[0]['location'], 'Zurich, Switzerland')
        self.assertEqual(asked, ['https://acme.teamtailor.com/jobs.rss', 'https://jobs.example.ch/jobs.rss'])

    def test_an_address_that_is_not_public_or_not_a_plain_host_is_refused(self):
        with mock.patch.object(ats, '_get', side_effect=AssertionError('asked')):
            with mock.patch.object(careers, '_public', return_value=False):
                with self.assertRaises(ValueError):
                    ats.teamtailor('internal.example.ch')   # a shared index entry must never make a run reach a private network
            with mock.patch.object(careers, '_public', return_value=True):
                for bad in ('jobs.example.ch/evil', 'jobs.example.ch:8080', 'a b.example', '..example'):
                    with self.assertRaises(ValueError, msg=bad):
                        ats.teamtailor(bad)

    def test_the_page_of_a_teamtailor_site_on_its_own_domain_is_read_from_that_domain(self):
        page = ('<script src="https://assets-aws.teamtailor-cdn.com/assets/careersite.js"></script><a href="https://app.teamtailor.com/companies/x/dashboard">x</a>'
                '<a href="https://tt.teamtailor.com/y">y</a><link rel="alternate" href="https://jobs.tamedia.ch/jobs.rss">')
        with mock.patch.object(careers, '_public', return_value=True):
            self.assertEqual(careers.embedded_system(page), ('teamtailor', 'jobs.tamedia.ch'))
            self.assertEqual(careers.embedded_system('<a href="https://acme.teamtailor.com/jobs">'), ('teamtailor', 'acme'))
            self.assertIsNone(careers.embedded_system('<a href="https://nope.example/jobs.rss">'))   # a feed address alone is not Teamtailor
            self.assertEqual(careers.embedded_system('<a href="https://acme.recruitee.com/o">'), ('recruitee', 'acme'))   # other systems unchanged
        with mock.patch.object(careers, '_public', return_value=False):
            self.assertIsNone(careers.embedded_system(page))   # a private address is never followed


class NamingWhatCouldNotBeReadTests(unittest.TestCase):
    CANDIDATE = {'name': 'Ringier', 'website': 'https://www.ringier.com'}

    def run_find(self, page, jobs):
        noted = []
        probe = lambda system, slug: jobs if (system, slug) == ('umantis', 'recruitingapp-1011') else None   # only the page's own system answers; the guessed names find nothing
        found = scout.find_feed(self.CANDIDATE, probe=probe, discover=lambda site: page, note=lambda *a: noted.append(a))
        return found, noted

    def test_a_system_that_gave_back_nothing_is_named_not_silent(self):
        found, noted = self.run_find({'ats': 'umantis', 'slug': 'recruitingapp-1011'}, None)
        self.assertIsNone(found)
        self.assertEqual(noted, [('umantis', 'recruitingapp-1011', 'read no jobs')])

    def test_a_system_with_no_adapter_says_so(self):
        found, noted = self.run_find({'ats': 'refline', 'slug': 'acme'}, None)
        self.assertEqual(noted, [('refline', 'acme', 'no adapter')])

    def test_nothing_is_said_when_jobs_were_read_or_the_page_is_plain(self):
        found, noted = self.run_find({'ats': 'umantis', 'slug': 'recruitingapp-1011'}, [{'title': 'Fotograf', 'location': 'Zurich'}])
        self.assertEqual((found[0], noted), ('umantis', []))
        self.assertEqual(self.run_find({'ats': 'careers', 'slug': 'x', 'jobs': []}, None)[1], [])
        self.assertEqual(self.run_find(None, None)[1], [])


class RecordingTests(unittest.TestCase):
    def database(self):
        db = sqlite3.connect(':memory:')
        db.row_factory = sqlite3.Row
        scout.harvest(db, {'excluded': []}, [lambda: []])
        return db

    def test_it_is_kept_once_per_system_and_company_and_said_in_the_log(self):
        db = self.database()
        out = io.StringIO()
        with redirect_stdout(out):
            counts = scout.record_unread(db, [('umantis', 'read no jobs', 'Ringier'), ('umantis', 'read no jobs', 'Kanton Bern'), ('refline', 'no adapter', 'ETH Zürich')])
            scout.record_unread(db, [('umantis', 'read no jobs', 'Ringier')])   # the same one again: still one row
        self.assertEqual(counts, {'umantis': 2, 'refline': 1})
        self.assertIn('Unread job systems this run: umantis ×2, refline ×1', out.getvalue())
        self.assertEqual(db.execute('SELECT COUNT(*) FROM unread_systems').fetchone()[0], 3)
        self.assertEqual(scout.central_stats(db, [])['unread_systems'], {'umantis': 2, 'refline': 1})

    def test_a_run_with_nothing_unread_says_nothing_and_the_stats_have_an_empty_list(self):
        db = self.database()
        out = io.StringIO()
        with redirect_stdout(out):
            scout.record_unread(db, [])
        self.assertEqual(out.getvalue(), '')
        self.assertEqual(scout.central_stats(self.database(), [])['unread_systems'], {})


if __name__ == '__main__':
    unittest.main()
