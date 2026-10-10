"""A match's scoring facts on this Mac's store are what a Notion user reads in 🎯 Job Matches: src/stores/matches_sync.py facts(),
written through the Notion store's columns (src/stores/notion_matches.py COLUMNS), equals src/notion/matches.py properties()."""
import unittest

from src.notion import matches as job_matches
from src.stores import matches_sync, notion_matches
from src.stores import notion_rows as rows
from tests.store_contract import AI, scored

FACTS = ('tier', 'confidence', 'code', 'scored', 'scoring_method', 'seniority', 'languages', 'salary', 'recruiter', 'technologies',
         'role_family', 'workload', 'on_call', 'visa', 'remote_scope', 'contract', 'deadline', 'posted', 'responsibilities')


class MatchFactsTests(unittest.TestCase):
    def assertSameColumns(self, job):
        facts = matches_sync.facts(job)
        columns = [c for c in notion_matches.COLUMNS if c[0] in FACTS and c[0] in facts]
        written = rows.to_properties({field: facts[field] for field, *_ in columns}, columns)
        notion = job_matches.properties(job, 'Open')
        for _, column, _ in columns:
            self.assertEqual(rows.read(written[column], dict((c[1], c[2]) for c in columns)[column]),
                             rows.read(notion.get(column), dict((c[1], c[2]) for c in columns)[column]), column)
        self.assertEqual({c[0] for c in notion_matches.COLUMNS if c[0] in FACTS}, set(FACTS), 'every fact has its column')

    def test_a_job_read_by_ai_has_every_fact_as_its_column(self):
        self.assertSameColumns({**scored('https://jobs.example/a', 80), 'ai': AI})

    def test_the_posting_facts_are_read_and_a_job_from_an_older_extractor_leaves_the_new_ones_empty(self):
        facts = matches_sync.facts({**scored('https://jobs.example/d', 80), 'ai': AI})
        self.assertEqual({k: facts[k] for k in ('workload', 'on_call', 'visa', 'remote_scope', 'contract', 'deadline', 'posted', 'responsibilities')},
                         {'workload': '80-100%', 'on_call': 'No', 'visa': 'Not offered', 'remote_scope': 'Switzerland',
                          'contract': 'Permanent', 'deadline': '2026-11-01', 'posted': '2026-10-03',
                          'responsibilities': 'Keep production reliable\nRun on-call and incidents'})
        old = {k: v for k, v in AI.items() if k not in ('contract', 'deadline', 'posted')}
        self.assertEqual(matches_sync.facts({**scored('https://jobs.example/e', 80), 'ai': old, 'posted_at': '2026-10-05T08:00'})['posted'],
                         '2026-10-05')   # the fetcher's own date wins when the extractor has none
        self.assertSameColumns({**scored('https://jobs.example/f', 80), 'ai': old})

    def test_a_job_not_read_by_ai_yet_has_the_score_facts_only(self):
        job = scored('https://jobs.example/b', 60)
        self.assertSameColumns(job)
        self.assertNotIn('languages', matches_sync.facts(job))

    def test_a_salary_not_stated_and_a_previous_scoring_read_as_notion_writes_them(self):
        job = {**scored('https://jobs.example/c', 70), 'ai': {**AI, 'salary': {'stated': False, 'text': 'maybe'}}}
        job['fit'] = {**job['fit'], 'method': 'Previous'}
        self.assertSameColumns(job)
        self.assertEqual((matches_sync.facts(job)['salary'], matches_sync.facts(job)['scoring_method']), ('', 'Previous'))


if __name__ == '__main__':
    unittest.main()
