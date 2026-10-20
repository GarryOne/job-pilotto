"""Reading refused sites in the user's own browser (owner, 19 Oct 2026): the queue (only refused employer sites and job boards, never a login-wall site,
each at most once in 30 days), and what a page the extension fetched becomes (a stop on 401/403, a bot check or a login page; a 429 waits a day,
never a stop; else the jobs on it)."""
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

from src.sources import host_pace, refused_reads, visits

NOW = datetime(2026, 10, 19, 9, 0, tzinfo=timezone.utc)
SEARCH = {'role_keywords': ['photographe'], 'locations': {'top_tier': ['Genève'], 'country_wide': []}}
BOARDS = {'boards': {
    'monsterboard.nl': {'name': 'Monsterboard', 'search_url': 'https://www.monsterboard.nl/vacatures?q={role}&where={place}', 'state': 'browser', 'last_read': NOW.isoformat()},
    'jobbird.com': {'name': 'Jobbird', 'search_url': 'https://www.jobbird.com/nl/vacature?s={role}', 'state': 'ok', 'last_read': NOW.isoformat()},
    'indeed.com': {'name': 'Indeed', 'search_url': 'https://www.indeed.com/jobs?q={role}', 'state': 'browser', 'last_read': NOW.isoformat()}}}
def _posting(n):
    return json.dumps({'@context': 'https://schema.org', '@type': 'JobPosting', 'title': f'Photographe de mode {n}', 'url': f'https://jobs.coop.ch/offres/{n}',
                       'jobLocation': {'@type': 'Place', 'address': {'addressLocality': 'Genève', 'addressCountry': 'CH'}}, 'hiringOrganization': {'@type': 'Organization', 'name': 'Coop'}})


JOBS = '<html><title>Careers</title><body>' + ''.join(f'<script type="application/ld+json">{_posting(n)}</script>' for n in range(1, 5)) + '</body></html>'


class RefusedReadsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.patches = [mock.patch.object(visits, 'STORE', Path(self.tmp.name) / 'visits.json'),
                        mock.patch('src.ai.board_ideas.load', lambda: json.loads(json.dumps(BOARDS))),
                        mock.patch.object(refused_reads, 'search_config', lambda: SEARCH),
                        mock.patch.object(host_pace, 'FILE', Path(self.tmp.name) / 'host_pace.json')]
        for patch in self.patches:
            patch.start()
        host_pace.reset()
        visits.refused('Coop', 'https://jobs.coop.ch', 'HTTP 403', now=NOW)
        visits.refused('Glassdoor', 'https://www.glassdoor.com/Job/x', 'HTTP 403', now=NOW)

    def tearDown(self):
        for patch in self.patches:
            patch.stop()
        host_pace.reset()
        self.tmp.cleanup()

    def test_queue_has_refused_employer_sites_and_boards_but_never_a_login_wall_site(self):
        listed = refused_reads.queue(now=NOW)
        self.assertEqual({item['url'].split('/')[2] for item in listed}, {'jobs.coop.ch', 'www.monsterboard.nl'})
        board = next(item for item in listed if item['kind'] == 'board')
        self.assertIn('q=photographe&where=Gen%C3%A8ve', board['url'], "a board's search page, filled with the user's own role and place")

    def test_every_never_host_is_refused_in_the_queue_and_in_the_outcome(self):
        for host in ['www.linkedin.com', 'de.indeed.com', 'www.glassdoor.com', 'www.levels.fyi', 'www.reddit.com', 'old.reddit.com']:
            self.assertFalse(refused_reads.allowed(f'https://{host}/jobs'), host)
            self.assertEqual(refused_reads.outcome(f'https://{host}/jobs', 200, JOBS, now=NOW)['state'], 'skipped', host)
        self.assertTrue(refused_reads.allowed('https://jobs.coop.ch/offres'))

    def test_a_site_is_asked_once_in_thirty_days_whatever_it_answered(self):
        for status, html in [(200, JOBS), (200, '<html>Please verify you are human</html>'), (200, '<html><body>No openings</body></html>')]:
            with self.subTest(status=status):
                visits._save({})
                visits.refused('Coop', 'https://jobs.coop.ch', 'HTTP 403', now=NOW)
                refused_reads.outcome('https://jobs.coop.ch', status, html, now=NOW)
                self.assertNotIn('jobs.coop.ch', {item['url'].split('/')[2] for item in refused_reads.queue(now=NOW + timedelta(days=29))})
                self.assertIn('jobs.coop.ch', {item['url'].split('/')[2] for item in refused_reads.queue(now=NOW + timedelta(days=31))})

    def test_a_refusal_a_bot_check_or_a_login_page_is_a_stop_and_nothing_is_read(self):
        for status, html, final in [(403, JOBS, ''), (401, '', ''), (200, '<html><body>Just a moment...</body></html>', ''),
                                    (200, JOBS, 'https://jobs.coop.ch/login?next=/jobs'), (200, JOBS, 'https://www.linkedin.com/uas/login')]:
            with self.subTest(status=status, final=final), mock.patch.object(visits, 'read') as read:
                result = refused_reads.outcome('https://jobs.coop.ch', status, html, final=final, now=NOW)
                self.assertEqual((result['ok'], result['state']), (True, 'stopped'))
                read.assert_not_called()

    def test_a_429_in_the_browser_waits_a_day_never_a_stop(self):
        with mock.patch.object(visits, 'read') as read:
            result = refused_reads.outcome('https://jobs.coop.ch', 429, '', now=NOW)
        self.assertEqual(result['state'], 'waiting')
        read.assert_not_called()
        self.assertNotIn('jobs.coop.ch', {item['url'].split('/')[2] for item in refused_reads.queue(now=NOW + timedelta(hours=12))})
        self.assertIn('jobs.coop.ch', {item['url'].split('/')[2] for item in refused_reads.queue(now=NOW + timedelta(days=refused_reads.WAIT_DAYS, hours=1))})

    def test_a_page_with_jobs_is_read_like_a_page_the_person_opened(self):
        result = refused_reads.outcome('https://jobs.coop.ch/offres', 200, JOBS, title='Careers', now=NOW)
        self.assertEqual(result['state'], 'read')
        self.assertGreaterEqual(result['jobs'], 3)
        self.assertTrue(result['feed'])

    def test_what_is_kept_says_when_and_how_it_ended(self):
        refused_reads.outcome('https://jobs.coop.ch/offres', 403, '', now=NOW)
        kept = visits._load()['refused_reads']['jobs.coop.ch']
        self.assertEqual((kept['state'], kept['why']), ('stopped', 'HTTP 403'))

    def test_the_limits_are_fixed_numbers_a_few_pages_one_at_a_time(self):
        self.assertEqual((refused_reads.READ_DAYS, refused_reads.MAX_QUEUE, refused_reads.CONCURRENCY), (30, 12, 1))


if __name__ == '__main__':
    unittest.main()
