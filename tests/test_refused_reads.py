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

    def test_a_site_every_step_stopped_at_rests_thirty_days_an_opened_one_seven(self):
        hosts = lambda when: {item['url'].split('/')[2] for item in refused_reads.queue(now=when)}
        for status, html, rests in [(200, JOBS, 7), (200, '<html><body>No openings</body></html>', 7), (200, '<html>Please verify you are human</html>', 30), (403, '', 30)]:
            with self.subTest(status=status, rests=rests):
                visits._save({})
                visits.refused('Coop', 'https://jobs.coop.ch', 'HTTP 403', now=NOW)
                refused_reads.outcome('https://jobs.coop.ch', status, html, now=NOW)
                self.assertNotIn('jobs.coop.ch', hosts(NOW + timedelta(days=rests - 1)))
                self.assertIn('jobs.coop.ch', hosts(NOW + timedelta(days=rests + 1)))

    def test_read_now_asks_a_resting_site_at_once_but_never_a_login_wall_site(self):
        refused_reads.outcome('https://jobs.coop.ch', 403, '', now=NOW)
        later = NOW + timedelta(hours=1)
        self.assertNotIn('jobs.coop.ch', {i['url'].split('/')[2] for i in refused_reads.queue(now=later)})
        self.assertIn('jobs.coop.ch', {i['url'].split('/')[2] for i in refused_reads.queue(now=later, now_hosts=['www.jobs.coop.ch'])})
        self.assertNotIn('glassdoor.com', {i['url'].split('/')[2] for i in refused_reads.queue(now=later, now_hosts=['glassdoor.com'])})

    def test_the_queue_starts_each_site_at_the_step_that_worked_last_time(self):
        refused_reads.outcome('https://jobs.coop.ch', 200, JOBS, now=NOW, step='tab')
        item = next(i for i in refused_reads.queue(now=NOW + timedelta(days=8)) if 'coop' in i['url'])
        self.assertEqual(item['step'], 'tab')

    def test_a_captcha_in_the_real_tab_is_never_solved_and_is_offered_to_the_person(self):
        with mock.patch.object(visits, 'read') as read:
            result = refused_reads.outcome('https://jobs.coop.ch', 200, '<html>x</html>', now=NOW, step='tab', captcha=True)
        read.assert_not_called()
        self.assertEqual((result['state'], result['why'], result['needs_check']), ('stopped', 'needs a quick check from you', True))
        listed = [site for site in visits.visit_list(now=NOW) if 'coop' in site['url']]
        self.assertTrue(listed, 'the site stays in the list of sites only you can open')
        self.assertEqual(next(f for f in refused_reads.shared() if f['host'] == 'jobs.coop.ch')['read'], {'outcome': 'bot', 'step': 'tab'})
        self.assertNotIn('jobs.coop.ch', {i['url'].split('/')[2] for i in refused_reads.queue(now=NOW + timedelta(days=29))}, 'not asked again by itself for 30 days')

    def test_a_route_is_a_job_system_and_its_account_or_a_plain_feed_nothing_else(self):
        good = [{'system': 'greenhouse', 'account': 'acme'}, {'system': 'workday', 'account': 'acme.wd3.Careers'}, {'system': 'phenom', 'account': 'careers.acme.com'},
                {'system': 'eightfold', 'account': 'acme.eightfold.ai'}, {'feed': 'https://acme.com/jobs.xml'}]
        for route in good:
            self.assertEqual(refused_reads.valid_route(route), route)
        for route in [{'system': 'visit', 'account': 'x'}, {'system': 'greenhouse', 'account': 'a b'}, {'system': 'workday', 'account': 'acme'},
                      {'feed': 'http://acme.com/j'}, {'feed': 'https://acme.com/j?q=nurse'}, {'feed': 'https://www.linkedin.com/jobs/x'},
                      {'system': 'greenhouse', 'account': 'acme', 'title': 'Nurse'}, {'system': 'lever', 'account': 'acme', 'feed': 'https://a.com/x'}, None, 'x']:
            self.assertIsNone(refused_reads.valid_route(route), route)

    def test_every_route_system_asks_the_readers_own_slug_rule(self):
        for system in refused_reads.ROUTE_SYSTEMS():
            with self.subTest(system=system):
                self.assertIsNone(refused_reads.valid_route({'system': system, 'account': 'not a slug!'}))

    def test_an_opened_page_that_links_to_a_job_system_shares_that_route_and_only_that(self):
        page = JOBS.replace('</body>', '<a href="https://boards.greenhouse.io/coopch/jobs/123">Apply</a></body>')
        refused_reads.outcome('https://jobs.coop.ch', 200, page, now=NOW, step='tab')
        fact = next(f for f in refused_reads.shared() if f['host'] == 'jobs.coop.ch')
        self.assertEqual(fact['read']['route'], {'system': 'greenhouse', 'account': 'coopch'})
        self.assertEqual(fact['read']['step'], 'tab')
        self.assertNotIn('Photographe', json.dumps(fact))

    def test_a_refusal_a_bot_check_or_a_login_page_is_a_stop_and_nothing_is_read(self):
        for status, html, final in [(403, JOBS, ''), (401, '', ''), (200, '<html><body>Just a moment...</body></html>', ''),
                                    (200, JOBS, 'https://jobs.coop.ch/login?next=/jobs'), (200, JOBS, 'https://www.linkedin.com/uas/login')]:
            with self.subTest(status=status, final=final), mock.patch.object(visits, 'read') as read:
                result = refused_reads.outcome('https://jobs.coop.ch', status, html, final=final, now=NOW)
                self.assertEqual((result['ok'], result['state']), (True, 'stopped'))
                read.assert_not_called()

    def test_a_failed_load_is_never_read_as_a_page_or_shared_as_opened(self):
        for status in (0, 404, 500, 502, 503, 410):   # no answer, gone, a server error: a blip, not a page and not a refusal
            with self.subTest(status=status), mock.patch.object(visits, 'read') as read:
                result = refused_reads.outcome('https://jobs.coop.ch', status, '', now=NOW)
                self.assertEqual(result['state'], 'waiting')
                read.assert_not_called()
                self.assertEqual([item for item in refused_reads.shared() if item['host'] == 'jobs.coop.ch'], [])
        self.assertEqual(refused_reads.outcome('https://jobs.coop.ch', 200, '<html></html>', now=NOW)['state'], 'empty')   # a real empty page still counts

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


class LongCheckPageTest(unittest.TestCase):
    def test_a_long_check_page_is_a_bot_check_in_the_download_step_too(self):
        long_check = '<html><head><title>Just a moment...</title><script>' + 'var a=1;' * 3500 + '</script></head><body>Checking your browser before accessing the site.</body></html>'
        self.assertGreater(len(long_check), 20000)
        self.assertEqual(refused_reads._stop_why(200, long_check, 'https://jobs.coop.ch/'), 'a bot check')
        real = '<html><body>' + 'Offre d emploi ' * 2000 + '</body></html>'
        self.assertEqual(refused_reads._stop_why(200, real, 'https://jobs.coop.ch/'), '')

if __name__ == '__main__':
    unittest.main()
