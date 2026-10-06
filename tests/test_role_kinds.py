"""Kinds of role (src/role_kinds.py): titles and searches classified, employers and boards picked by kind, the website's list in step, and
employers that never match resting a while (6 Oct 2026: a photographer's checks read 190 software employers for 0 matches)."""
import re
import tempfile
import unittest
from pathlib import Path
import sys
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src import employer_index, role_kinds  # noqa: E402
from src.sources import feeds  # noqa: E402

PHOTOGRAPHER = {'role_keywords': ['photograph(e|er)?', 'retoucheu?r', 'vendeu(r|se)', 'responsable de (magasin|boutique)', 'magasinier',
                                  r'pr[ée]parateur de commandes'], 'locations': {'top_tier': ['geneva'], 'country_wide': [], 'abroad': []}}


class KindTests(unittest.TestCase):
    def test_titles_get_their_kind(self):
        cases = {'Photographe événementiel': 'creative_media', 'Vendeur/se 80%': 'sales_retail', 'Responsable de magasin': 'sales_retail',
                 'Magasinier CFC': 'logistics', 'Préparateur de commandes': 'logistics', 'Senior Site Reliability Engineer': 'software',
                 'Softwareentwickler': 'software', 'Barista': 'hospitality', 'Infirmière': 'healthcare', 'Comptable': 'finance_admin', 'Zzz': 'other'}
        self.assertEqual({title: role_kinds.kind_of(title) for title in cases}, cases)

    def test_a_search_has_the_kinds_of_its_roles_or_none_when_unknown(self):
        self.assertEqual(role_kinds.of_search(PHOTOGRAPHER), {'creative_media', 'sales_retail', 'logistics'})
        self.assertIsNone(role_kinds.of_search({'role_keywords': []}))
        self.assertIsNone(role_kinds.of_search({'role_keywords': ['zzz']}), 'words we cannot place: as unknown, nothing skipped')

    def test_a_mix_needs_enough_titles_and_drops_noise(self):
        self.assertIsNone(role_kinds.mix(['Engineer'] * 4))
        self.assertEqual(role_kinds.mix(['Backend Engineer'] * 19 + ['Barista']), {'software': 0.95, 'hospitality': 0.05})
        self.assertEqual(role_kinds.mix(['Backend Engineer'] * 30 + ['Barista']), {'software': 0.97})

    def test_employers_are_kept_for_the_users_kinds_or_when_unsure(self):
        wanted = role_kinds.of_search(PHOTOGRAPHER)
        index = [{'company': 'Datadog', 'places': ['Geneva'], 'kinds': {'software': 0.95}},
                 {'company': 'Manor', 'places': ['Geneva'], 'kinds': {'sales_retail': 0.6, 'logistics': 0.3}},
                 {'company': 'Old entry', 'places': ['Geneva']},
                 {'company': 'Unreadable titles', 'places': ['Geneva'], 'kinds': {'other': 0.8, 'software': 0.2}},
                 {'company': 'Zurich shop', 'places': ['Zurich'], 'kinds': {'sales_retail': 1.0}}]
        geneva = lambda job: 'geneva' in job['location'].lower()
        kept = [f['company'] for f in employer_index.relevant(index, geneva, wanted)]
        self.assertEqual(kept, ['Manor', 'Old entry', 'Unreadable titles'])
        self.assertEqual(len(employer_index.relevant(index, geneva)), 4, 'without kinds: places only, as before')
        self.assertEqual(len(employer_index.relevant(index, geneva, None)), 4, 'roles not known: nothing skipped by kind')

    def test_the_index_keeps_a_valid_mix_only(self):
        feeds_in = [{'company': 'A', 'ats': 'lever', 'slug': 'a', 'kinds': {'software': 0.9, 'hacking': 1, 'other': 3}},
                    {'company': 'B', 'ats': 'lever', 'slug': 'b', 'kinds': 'software'}]
        out = employer_index.clean(feeds_in)
        self.assertEqual(out[0]['kinds'], {'software': 0.9})
        self.assertNotIn('kinds', out[1])

    def test_the_website_knows_the_same_kinds(self):
        site = (ROOT / 'site' / 'src' / 'employers.js').read_text()
        listed = re.search(r'export const KINDS = \[([^\]]+)\]', site).group(1)
        self.assertEqual(tuple(re.findall(r"'(\w+)'", listed)), role_kinds.KINDS)


class RestTests(unittest.TestCase):
    def db(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        return feeds.database(Path(folder.name) / 'jobs.sqlite')

    def scan(self, db, titles, places='Geneva'):
        jobs = [{'id': str(i), 'title': t, 'location': places, 'url': f'https://x/{i}', 'remote': False} for i, t in enumerate(titles)]
        with mock.patch.object(feeds, 'wanted_location', lambda job: 'geneva' in (job.get('location') or '').lower()), \
                mock.patch.object(feeds, 'wanted_title', lambda title: 'photograph' in title.lower()), \
                mock.patch.object(feeds, 'excluded_title', lambda title: False):
            return feeds.scan([{'company': 'Datadog', 'ats': 'lever', 'slug': 'datadog'}], db, fetcher=lambda source: jobs, details={})

    def test_an_employer_with_no_match_rests_after_five_checks_and_a_match_or_a_new_search_wakes_it(self):
        db = self.db()
        for _ in range(feeds.REST_AFTER):
            self.assertEqual(len(self.scan(db, ['Backend Engineer'])['sources']), 1)
        sixth = self.scan(db, ['Backend Engineer'])
        self.assertEqual((sixth['sources'], sixth['rested']), ([], 1), 'resting: not fetched')
        with mock.patch.object(feeds, '_SEARCH', {'role_keywords': ['barista'], 'locations': {}}):
            self.assertEqual(feeds.resting(db, '2099-01-01T00:00:00'), {}, 'another search starts over')

    def test_a_match_clears_the_count(self):
        db = self.db()
        for _ in range(feeds.REST_AFTER - 1):
            self.scan(db, ['Backend Engineer'])
        self.scan(db, ['Photographer'])
        self.assertEqual(db.execute('SELECT COUNT(*) FROM feed_rest').fetchone()[0], 0)


if __name__ == '__main__':
    unittest.main()


class NotWarningsTests(unittest.TestCase):
    def test_the_lines_saying_what_was_left_out_are_not_read_as_warnings(self):
        """The app shows a log line with "skipped" or "failed" as a warning (desktop/renderer/run-warnings.js WARNING): a run that only left out
        what does not fit turned yellow (6 Oct 2026). Every informational line about choosing sources avoids those words."""
        warning = re.compile(r'\b(?:skipped|failed)\b', re.I)
        js = (ROOT / 'desktop' / 'renderer' / 'run-warnings.js').read_text()
        self.assertIn('skipped|failed', js, 'the app still reads these words as warnings; update this test if that changed')
        prefixes = ('Job boards:', 'Scout: reading', 'Employers:', 'Employers resting:')
        for path in ('src/sources/boards.py', 'src/scout.py', 'src/daily.py', 'src/sources/feeds.py'):
            for line in (ROOT / path).read_text().splitlines():
                if 'print(' in line and any(prefix in line for prefix in prefixes):
                    self.assertIsNone(warning.search(line), f'{path}: {line.strip()[:120]}')


class AggregatorKindTests(unittest.TestCase):
    def test_jobicy_is_asked_only_for_an_it_search(self):
        """Jobicy is read by IT tags (devops, sre, kubernetes): a photographer's check asked it for DevOps jobs (6 Oct 2026)."""
        from src.sources import aggregators
        with mock.patch.object(aggregators, 'jobicy', lambda: ['a remote DevOps job']):
            reader = dict(aggregators.sources({'JOB_PILOTTO_DISABLE': ''}))['Jobicy']
            self.assertEqual(reader(PHOTOGRAPHER), [])
            self.assertEqual(reader({'role_keywords': [r'\bsre\b']}), ['a remote DevOps job'])


class RoleFamilyTests(unittest.TestCase):
    def test_enrichment_knows_every_kind_of_role(self):
        """The AI's role family (src/ai/enrich.py) can name every non-IT kind (6 Oct 2026: a photographer's jobs could only be 'other')."""
        from src.ai import enrich
        families = set(enrich.SCHEMA['properties']['role_family']['enum'])
        self.assertTrue(set(role_kinds.KINDS) - {'software', 'other'} <= families)
