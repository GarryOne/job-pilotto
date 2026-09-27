import json
import tempfile
import unittest
from unittest import mock
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.sources import ats
from src import store as job_store
from src import scout

SEEDS = {'excluded': ['Sonar'], 'tier1_known': [{'name': 'Bigco', 'ats': 'lever', 'slug': 'bigco'}],
         'tier1': ['Farco'], 'manual_watch': [{'name': 'Walledco', 'careers': 'https://walled.test/jobs'}],
         'regional': {'Zurich': ['Smallco', 'Sonar', 'Nofeed']}}


def posting(i, title='Site Reliability Engineer', location='Zurich, Switzerland', **extra):
    return dict({'id': str(i), 'title': title, 'location': location, 'url': f'https://x.test/{i}',
                 'date_posted': '2099-01-01', 'description': 'Kubernetes and Terraform', 'remote': False,
                 'salary': ''}, **extra)


FEEDS = {
    ('lever', 'bigco'): [posting(1), posting(2, location='London'), posting(3, title='Sales')],
    ('greenhouse', 'farco'): [posting(i, location='Seattle') for i in range(4)],   # Tier 1, none in our places
    ('ashby', 'smallco'): [posting(9, title='Accountant')],                         # feed, nothing relevant
}


def fake_probe(system, slug):
    return FEEDS.get((system, slug))


class FakeTracker:
    def __init__(self):
        self.created, self.updated = [], []

    def query_database(self, database_id, filter_=None):
        return []

    def create_page(self, database_id, properties):
        self.created.append((database_id, properties))
        return {'id': 'p'}

    def update_page(self, page_id, properties):
        self.updated.append(properties)


class ScoutTests(unittest.TestCase):
    def run_scout(self, db, tracker=None, batch=10):
        return scout.run(db, batch, tracker, SEEDS, fake_probe, harvest_sources=[lambda: scout.seed_candidates(SEEDS)])

    def test_companies_excluded_from_the_environment_are_never_harvested(self):
        seeds = dict(SEEDS, excluded=[])
        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.dict('os.environ', {'JOB_PILOTTO_EXCLUDED_COMPANIES': ' Sonar , Other'}):
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                scout.harvest(db, seeds, sources=[lambda: scout.seed_candidates(seeds)])
                names = {row['name'] for row in db.execute('SELECT name FROM scout_candidates')}
        self.assertIn('Smallco', names)
        self.assertNotIn('Sonar', names)

    def test_tier1_first_found_low_none_and_exclusions(self):
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                tracker = FakeTracker()
                summary, results = self.run_scout(db, tracker)
                outcome = {c['name']: o['status'] for c, o in results}
                self.assertEqual([c['name'] for c, _ in results][:3], ['Bigco', 'Farco', 'Walledco'])
                self.assertEqual(outcome, {'Bigco': 'found', 'Farco': 'found', 'Walledco': 'manual',
                                           'Smallco': 'low', 'Nofeed': 'none'})
                self.assertNotIn('Sonar', outcome)
                self.assertEqual(summary['total_feeds'], 2)
                sources = {(s['ats'], s['slug']) for s in scout.active_sources(db)}
                self.assertEqual(sources, {('lever', 'bigco'), ('greenhouse', 'farco')})
                rows = {p['Company']['title'][0]['text']['content']: p for db_id, p in tracker.created
                        if db_id == scout.EMPLOYERS_DB}
                self.assertEqual(sorted(rows), ['Bigco', 'Farco', 'Smallco', 'Walledco'])  # 'Nofeed' skipped
                self.assertTrue(rows['Bigco']['Active']['checkbox'])
                self.assertEqual(rows['Bigco']['ATS'], {'select': {'name': 'lever'}})
                self.assertFalse(rows['Smallco']['Active']['checkbox'])
                self.assertEqual(rows['Walledco']['Feed status'], {'select': {'name': 'Manual watch'}})
                research = list(rows.values())
                self.assertTrue(research[0]['Glassdoor']['url'].startswith('https://www.glassdoor.com/'))
                # Next run continues: nothing pending, nothing re-probed until its recheck date.
                summary, results = self.run_scout(db)
                self.assertEqual(results, [])

    def test_quality_rewards_relevant_roles_in_preferred_places(self):
        high, stats = scout.quality([posting(i) for i in range(5)] + [posting(9, salary='CHF 150k')])
        low, _ = scout.quality([posting(i, location='Seattle') for i in range(5)])
        self.assertGreater(high, 80)
        self.assertLess(low, 45)
        self.assertEqual(stats['swiss'], 6)

    def test_detects_ats_in_links(self):
        self.assertEqual(ats.detect('https://job-boards.greenhouse.io/datadog/jobs/123'), ('greenhouse', 'datadog'))
        self.assertEqual(ats.detect('https://jobs.lever.co/palantir/abc'), ('lever', 'palantir'))
        self.assertEqual(ats.detect('https://jobs.ashbyhq.com/posthog'), ('ashby', 'posthog'))
        self.assertEqual(ats.detect('https://acme.jobs.personio.de/job/1'), ('personio', 'acme'))
        self.assertIsNone(ats.detect('https://example.com/careers'))
        self.assertEqual(ats.slug_guesses('Digitec Galaxus AG'), ['digitecgalaxus', 'digitec-galaxus', 'digitec'])

    def test_hacker_news_posts_become_candidates(self):
        def get(url):
            if 'search_by_date' in url:
                return {'hits': [{'title': 'Ask HN: Who is hiring? (September 2026)', 'objectID': '1'}]}
            return {'children': [
                {'text': 'Acme | SRE | Zurich or Remote (EU) | <a href="https://jobs.lever.co/acme/1">apply</a>'},
                {'text': 'Other | Sales | New York'}]}
        found = list(scout.hacker_news_candidates(get=get))
        self.assertEqual([(c['name'], c['ats'], c['slug']) for c in found], [('Acme', 'lever', 'acme')])



def employer_row(name, system, slug, **props):
    return {'properties': {'Company': {'title': [{'plain_text': name}]}, 'ATS': {'select': {'name': system}},
                           'Slug': {'rich_text': [{'plain_text': slug}]}, **props}}


class ExportSourcesTests(unittest.TestCase):
    def test_merges_verifies_and_keeps_only_public_facts(self):
        tracker = FakeTracker()
        tracker.query_database = lambda db, filter_=None: [
            employer_row('Anthropic', 'greenhouse', 'anthropic', Notes={'rich_text': [{'plain_text': 'applied twice'}]}),
            employer_row('Deadco', 'lever', 'deadco'),
            employer_row('Cloudflare again', 'greenhouse', 'cloudflare'),   # already in the file: file name wins
            employer_row('Custom site', 'workday', 'x')]                    # not a crawlable feed type: skipped

        def fetch(system, slug):
            if slug == 'deadco':
                raise TimeoutError('no answer')
            return [{}] * {'anthropic': 72, 'cloudflare': 380}[slug]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'sources.json'
            path.write_text(json.dumps([{'company': 'Cloudflare', 'board': 'cloudflare'}]))
            kept, failed = scout.export_sources(tracker, path, fetch, today='2026-09-27')
            written = json.loads(path.read_text())
        self.assertEqual(written, kept)
        self.assertEqual(written, [
            {'company': 'Anthropic', 'ats': 'greenhouse', 'slug': 'anthropic', 'jobs': 72, 'checked': '2026-09-27'},
            {'company': 'Cloudflare', 'ats': 'greenhouse', 'slug': 'cloudflare', 'jobs': 380, 'checked': '2026-09-27'}])
        self.assertEqual([(f['company'], f['error']) for f in failed], [('Deadco', 'TimeoutError: no answer')])
        self.assertNotIn('applied', json.dumps(written))

    def test_exported_file_feeds_the_crawl(self):
        # The written entries are what feeds.scan and active_sources read.
        entry = {'company': 'Anthropic', 'ats': 'greenhouse', 'slug': 'anthropic', 'jobs': 72, 'checked': '2026-09-27'}
        with tempfile.TemporaryDirectory() as tmp, job_store.connect(Path(tmp) / 'db') as db:
            sources = scout.active_sources(db, None, [entry])
        self.assertEqual([(s['company'], s['ats'], s['slug']) for s in sources], [('Anthropic', 'greenhouse', 'anthropic')])


if __name__ == '__main__':
    unittest.main()
