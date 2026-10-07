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

SEEDS = {'excluded': ['Acme'], 'tier1_known': [{'name': 'Bigco', 'ats': 'lever', 'slug': 'bigco'}],
         'tier1': ['Farco'], 'manual_watch': [{'name': 'Walledco', 'careers': 'https://walled.test/jobs'}],
         'regional': {'Zurich': ['Smallco', 'Acme', 'Nofeed']}}


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

    def test_every_tech_only_list_is_marked_and_the_trade_agnostic_ones_are_not(self):
        """The class, not one case: each source of software employers yields origins a non-IT search skips, so a new one cannot slip past."""
        skip = scout.skipped_origins(SEEDS, technical=False)
        import re
        hn = {'hits': [{'title': 'Ask HN: Who is hiring? (October 2026)', 'objectID': '1'}]}
        get_hn = lambda url: hn if 'search_by_date' in url else {'children': [{'text': 'Acme | Engineer | Geneva'}]}
        readme = '- [Acme](https://acme.test/jobs) | Geneva | x'
        with mock.patch.object(scout, 'LOCATION_WORDS', re.compile('.')), mock.patch.object(scout, 'ROLE_WORDS', re.compile('.')):
            tech = {'seeds': list(scout.seed_candidates(SEEDS)), 'hacker news': list(scout.hacker_news_candidates(get=get_hn)),
                    'whiteboards': list(scout.whiteboards_candidates(get=lambda url: readme)),
                    'swissdevjobs': list(scout.swissdevjobs_candidates(get=lambda url: [{'company': 'Acme', 'companyWebsiteLink': 'acme.test'}]))}
        wikidata = {'results': {'bindings': [{'label': {'value': 'Hotelco'}, 'site': {'value': 'https://hotel.test'}}]}}
        with tempfile.TemporaryDirectory() as tmp, job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
            db.execute("INSERT INTO companies (name, careers_url, website, updated_at) VALUES ('Shopco', '', 'https://shop.test', '2026-10-06')")
            general = list(scout.local_company_candidates(db)) + list(scout.wikidata_candidates(get=lambda url, **_: wikidata, cache=Path(tmp) / 'w.json'))
        for source, found in tech.items():
            self.assertTrue(found, source)
            self.assertTrue(all(c['origin'].startswith(skip) for c in found), source)
        self.assertTrue(general)
        self.assertFalse(any(c['origin'].startswith(skip) for c in general))
        self.assertFalse('AI idea 2026-10-06'.startswith(skip) or 'AI list: gva.ch'.startswith(skip))
        self.assertEqual(scout.skipped_origins(SEEDS, technical=True), (), 'an IT search skips nothing')
        own = scout.skipped_origins(dict(SEEDS, tech_only=False), technical=False)
        self.assertFalse(any(c['origin'].startswith(own) for c in tech['seeds']), 'a seed list of your own trade is kept')

    def test_a_search_outside_it_never_harvests_nor_probes_the_tech_lists(self):
        """6 Oct 2026: a photographer's scout checked Netflix and Stripe while the AI's Geneva retail ideas waited."""
        with tempfile.TemporaryDirectory() as tmp, job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
            # A queue left from before (roles changed, or an older version): tech seeds rank highest.
            scout.harvest(db, SEEDS, sources=[lambda: scout.seed_candidates(SEEDS)])
            ideas = [dict(name='Manor', origin='AI idea 2026-10-06', priority=92), dict(name='Fnac', origin='AI list: gva.ch', priority=90),
                     dict(name='Stack Co', origin='SwissDevJobs employer', priority=88)]
            skip = scout.skipped_origins(SEEDS, technical=False)
            scout.harvest(db, SEEDS, sources=[lambda: ideas], skip=skip)
            names = {row['name'] for row in db.execute('SELECT name FROM scout_candidates')}
            self.assertNotIn('Stack Co', names, 'a tech list is not harvested for a non-tech search')
            self.assertEqual([c['name'] for c in scout.next_batch(db, 10, skip)], ['Manor', 'Fnac'])
            self.assertEqual(scout.next_batch(db, 1)[0]['name'], 'Bigco', 'an IT search keeps its Tier 1 seeds first')

    def test_the_summary_says_how_many_were_new_to_the_search(self):
        with tempfile.TemporaryDirectory() as tmp, job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
            summary, _ = self.run_scout(db, batch=10)
            self.assertEqual(summary['first_time'], summary['checked'], 'a first run checks only names never checked')
            again, _ = self.run_scout(db, batch=10)
            self.assertEqual(again['first_time'], 0, 'nothing new left: whatever is checked is a re-check after its wait')
            card = scout.telegram_summary(summary, [])
            self.assertIn(f"{summary['checked']} new to the search", card)

    def test_a_known_job_site_is_read_before_any_guess(self):
        jobs = [{'title': f'Horloger {i}', 'location': 'Genève'} for i in range(9)]
        guessed = []
        found = scout.find_feed({'name': 'Rolex', 'website': 'https://www.rolex.com', 'careers': 'https://www.carrieres-rolex.com/'},
                                lambda system, slug: guessed.append(slug) or (jobs if (system, slug) == ('successfactors', 'www.carrieres-rolex.com') else None),
                                lambda url: {'ats': 'successfactors', 'slug': 'www.carrieres-rolex.com'} if 'carrieres-rolex' in url else None)
        self.assertEqual(found[:2], ('successfactors', 'www.carrieres-rolex.com'))
        self.assertEqual(guessed, ['www.carrieres-rolex.com'], 'no name guessed: the job site answered')

    def test_a_small_name_guess_loses_to_the_companys_own_job_site(self):
        """6 Oct 2026: Coop Suisse Romande took JOIN's "coop" (1 job, another company); its own job site jobs.coop.ch runs SuccessFactors."""
        own = [{'title': f'Vendeur {i}', 'location': 'Genève'} for i in range(40)]
        probe = lambda system, slug: [{'title': 'Koch', 'location': 'Berlin'}] if (system, slug) == ('join', 'coop') else \
            own if (system, slug) == ('successfactors', 'jobs.coop.ch') else None
        tried = []
        discover = lambda url: tried.append(url) or ({'ats': 'successfactors', 'slug': 'jobs.coop.ch'} if url == 'https://jobs.coop.ch' else None)
        system, slug, jobs = scout.find_feed({'name': 'Coop Suisse Romande', 'website': 'https://www.coop.ch'}, probe, discover)
        self.assertEqual((system, slug, len(jobs)), ('successfactors', 'jobs.coop.ch', 40))
        self.assertEqual(tried[:2], ['https://www.coop.ch', 'https://jobs.coop.ch'], 'the home page first, then the usual job site')
        big = lambda system, slug: own if (system, slug) == ('join', 'coop') else None
        self.assertEqual(scout.find_feed({'name': 'Coop', 'website': 'https://www.coop.ch'}, big, lambda url: None)[:2], ('join', 'coop'),
                         'a guess with many jobs is kept without asking the website')
        self.assertEqual(scout.job_hosts('https://jobs.coop.ch'), [], 'already a job site')
        self.assertEqual(scout.job_hosts('manor.ch')[1], 'https://careers.manor.ch')

    def test_employers_judged_by_older_readers_are_checked_again(self):
        """6 Oct 2026: employers probed while the readers were wrong stayed 'no feed' for 90 days; a reader change brings them back."""
        with tempfile.TemporaryDirectory() as tmp, job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
            scout.harvest(db, SEEDS, sources=[lambda: [dict(name=n, origin='AI idea', priority=92) for n in ('Old', 'Current', 'New')]])
            later = '2099-01-01T00:00:00+00:00'
            db.execute("UPDATE scout_candidates SET status='none', checked_at='2026-10-06', next_check=?, checked_with='0123456789ab' WHERE name='Old'", (later,))
            db.execute("UPDATE scout_candidates SET status='none', checked_at='2026-10-06', next_check=?, checked_with=? WHERE name='Current'", (later, scout.READERS))
            names = [c['name'] for c in scout.next_batch(db, 50) if c['name'] in ('Old', 'Current', 'New')]
            self.assertEqual(names, ['New', 'Old'], 'never-checked names first, then the old judgement; the current one waits its 90 days')

    def test_companies_excluded_from_the_environment_are_never_harvested(self):
        seeds = dict(SEEDS, excluded=[])
        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.dict('os.environ', {'JOB_PILOTTO_EXCLUDED_COMPANIES': ' Acme , Other'}):
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                scout.harvest(db, seeds, sources=[lambda: scout.seed_candidates(seeds)])
                names = {row['name'] for row in db.execute('SELECT name FROM scout_candidates')}
        self.assertIn('Smallco', names)
        self.assertNotIn('Acme', names)

    def test_a_candidate_on_a_board_already_in_the_starter_list_is_a_duplicate(self):
        """E2E Acme Labs on the board of the starter source E2E Acme was registered as a new source and written to Employers & Sources again (found by the employers e2e suite, 2 Oct 2026)."""
        seeds = {'excluded': [], 'tier1_known': [{'name': 'Bigco Labs', 'ats': 'lever', 'slug': 'bigco'}], 'tier1': [], 'manual_watch': [], 'regional': {}}
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / 'sources.json').write_text(json.dumps([{'company': 'Bigco', 'ats': 'lever', 'slug': 'bigco'}]))
            with mock.patch.object(scout, 'CONFIG', Path(tmp)), job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                tracker = FakeTracker()
                summary, results = scout.run(db, 10, tracker, seeds, fake_probe, harvest_sources=[lambda: scout.seed_candidates(seeds)])
                self.assertEqual([o['status'] for _, o in results], ['duplicate'])
                self.assertEqual(summary['total_feeds'], 0)
                self.assertEqual(tracker.created, [])
                self.assertEqual(db.execute('SELECT COUNT(*) FROM feed_sources').fetchone()[0], 0)

    def test_tier1_first_found_low_none_and_exclusions(self):
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                tracker = FakeTracker()
                summary, results = self.run_scout(db, tracker)
                outcome = {c['name']: o['status'] for c, o in results}
                self.assertEqual([c['name'] for c, _ in results][:3], ['Bigco', 'Farco', 'Walledco'])
                self.assertEqual(outcome, {'Bigco': 'found', 'Farco': 'found', 'Walledco': 'manual',
                                           'Smallco': 'low', 'Nofeed': 'none'})
                self.assertNotIn('Acme', outcome)
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
        self.assertEqual(ats.detect('https://job-boards.greenhouse.io/embed/job_app?for=n26&token=7768035'),
                         ('greenhouse', 'n26'))
        self.assertEqual(ats.detect('https://boards.greenhouse.io/embed/job_board?for=acme'), ('greenhouse', 'acme'))
        from src.daily import _url_key
        embed = 'https://job-boards.greenhouse.io/embed/job_app?for=n26&token=7768035'
        careers = 'https://n26.com/en-eu/careers/positions/7768035?gh_jid=7768035'
        self.assertEqual(_url_key(embed), _url_key(careers))
        self.assertEqual(_url_key(embed), 'greenhouse:7768035')

    def test_an_embed_application_link_reads_the_same_board_posting(self):
        job = ats._job('7768035', 'Senior Site Reliability Engineer', 'Berlin',
                       'https://n26.com/en-eu/careers/positions/7768035?gh_jid=7768035', '',
                       'Own the platform and the access path. ' * 4)
        with mock.patch.object(ats, '_board', return_value=(job,)):
            found = ats.posting('https://job-boards.greenhouse.io/embed/job_app?for=n26&token=7768035')
        self.assertEqual(found['id'], '7768035')
        self.assertIn('Own the platform', found['description'])
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
            employer_row('Custom site', 'taleo', 'x')]                    # not a crawlable feed type: skipped

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



class RunHeadlineTest(unittest.TestCase):
    def test_the_headline_keeps_the_counts_the_card_puts_on_its_second_line(self):
        from src import tgcard
        card = tgcard.card('New employer sources', tgcard.dot('7 checked', '2 new sources'), [tgcard.block('Not added', 'x')], '🔎')
        self.assertEqual(scout.run_headline(card), '🔎 New employer sources · 7 checked · 2 new sources')
        self.assertEqual(scout.run_headline(tgcard.card('Quiet', '')), 'Quiet')

if __name__ == '__main__':
    unittest.main()
