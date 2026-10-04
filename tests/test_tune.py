"""Tune my strategy (src/tune.py): what the owner's own outcomes say about the search settings."""
import unittest

from src import tune


def jobs(title, location, stage, n):
    return [{'title': title, 'location': location, 'stage': stage} for _ in range(n)]


SEARCH = {'role_keywords': ['data analyst', r'\bbi\b', 'analytics engineer'],
          'title_exclude_keywords': [r'\bsales\b'],
          'locations': {'top_tier': ['z[uü]rich'], 'country_wide': ['switzerland'], 'abroad': ['berlin']}}


class Proposals(unittest.TestCase):
    def test_a_role_only_ever_dismissed_is_proposed_for_removal(self):
        found = tune.proposals(SEARCH, jobs('BI Developer', 'Zurich', 'Dismissed', 6) + jobs('Data Analyst', 'Zurich', 'Applied', 2))
        drops = [p for p in found if p['kind'] == 'drop_role']
        self.assertEqual([p['fragment'] for p in drops], [r'\bbi\b'])
        self.assertEqual(drops[0]['label'], 'bi')
        self.assertIn('6 role "bi" jobs dismissed', drops[0]['why'])

    def test_one_kept_job_is_enough_to_keep_a_term(self):
        found = tune.proposals(SEARCH, jobs('BI Developer', 'Zurich', 'Dismissed', 9) + jobs('BI Analyst', 'Zurich', 'Saved', 1))
        self.assertFalse([p for p in found if p['kind'] == 'drop_role'])

    def test_too_few_dismissals_say_nothing(self):
        self.assertEqual(tune.proposals(SEARCH, jobs('BI Developer', 'Berlin', 'Dismissed', tune.MIN_DISMISSED - 1)), [])

    def test_a_place_only_ever_dismissed_is_proposed(self):
        found = tune.proposals(SEARCH, jobs('Data Analyst', 'Berlin, Germany', 'Dismissed', 5) + jobs('Data Analyst', 'Zurich', 'Applied', 3))
        places = [p for p in found if p['kind'] == 'drop_place']
        self.assertEqual([(p['list'], p['fragment']) for p in places], [('abroad', 'berlin')])

    def test_never_every_role(self):
        search = dict(SEARCH, role_keywords=['data analyst'])
        found = tune.proposals(search, jobs('Data Analyst', 'Zurich', 'Dismissed', 8))
        self.assertFalse([p for p in found if p['kind'] == 'drop_role'])

    def test_a_title_word_seen_only_in_dismissed_jobs_is_proposed_as_an_exclusion(self):
        found = tune.proposals(SEARCH, jobs('Data Analyst Marketing', 'Zurich', 'Dismissed', 5) + jobs('Data Analyst', 'Zurich', 'Applied', 2))
        excludes = [p for p in found if p['kind'] == 'exclude_title']
        self.assertEqual([p['fragment'] for p in excludes], [r'\bmarketing\b'])
        # The role words themselves are never proposed: they're in the jobs kept too, and in the role terms.
        self.assertNotIn('analyst', [p['label'] for p in found])

    def test_an_already_excluded_word_is_not_proposed_again(self):
        found = tune.proposals(SEARCH, jobs('Data Analyst Sales', 'Zurich', 'Dismissed', 6) + jobs('Data Analyst', 'Zurich', 'Applied', 1))
        self.assertNotIn('sales', [p['label'] for p in found if p['kind'] == 'exclude_title'])


class Run(unittest.TestCase):
    def test_reads_stages_by_url_and_reports_the_basis(self):
        import sqlite3
        db = sqlite3.connect(':memory:')
        db.row_factory = sqlite3.Row
        db.execute('CREATE TABLE jobs (title TEXT, location TEXT, city TEXT, url TEXT)')
        rows = [(f'BI Developer {i}', 'Zurich', None, f'https://x/{i}') for i in range(6)] + [('Data Analyst', 'Zurich', None, 'https://x/a')]
        db.executemany('INSERT INTO jobs VALUES (?, ?, ?, ?)', rows)
        stages = {f'https://x/{i}': 'Dismissed' for i in range(6)} | {'https://x/a': 'Interviewing'}
        answer = tune.run(db, type('T', (), {'url_stages': lambda self: stages})(), SEARCH)
        self.assertTrue(answer['ok'])
        self.assertEqual(answer['basis'], {'jobs': 7, 'dismissed': 6, 'engaged': 1, 'interviews': 1, 'min_dismissed': tune.MIN_DISMISSED})
        self.assertIn(r'\bbi\b', [p['fragment'] for p in answer['proposals']])


if __name__ == '__main__':
    unittest.main()
