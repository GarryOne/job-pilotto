"""A refresh takes one batch end to end (owner, 7 Oct 2026: "a batch should handle it from start to finish"): the jobs it reads are the ones it
scores, the rest waits for the next refresh, and jobs not scored yet are counted as waiting, not listed as matches."""
import sqlite3
import unittest
from unittest import mock

from src import desktop


def row(i, **kw):
    return {'id': i, 'url': f'https://x/{i}', 'title': 'Vendeur', 'company': 'Coop', 'location': 'Lausanne', 'work_mode': '', 'notes': '',
            'application_status': 'unreviewed', 'first_seen_at': '2026-10-07', **kw}


class WaitingTests(unittest.TestCase):
    def listed(self, hide):
        local = [row(1), row(2), row(3, notes='imported'), row(4, application_status='saved')]
        with mock.patch.object(desktop.digest, 'eligible_jobs', return_value=(local, [])), \
                mock.patch.object(desktop.score, 'load', return_value={1: {'score': 70, 'summary': 'ok'}}):
            return desktop.jobs(sqlite3.connect(':memory:'), notion_jobs=[], hide_unscored=hide)

    def test_unscored_jobs_wait_counted_but_yours_stay(self):
        result = self.listed(True)
        self.assertEqual({r['url'] for r in result['jobs']}, {'https://x/1', 'https://x/3', 'https://x/4'})
        self.assertEqual(result['waiting'], 1, 'job 2: found, not scored, not touched by you')

    def test_without_an_ai_everything_found_is_listed(self):
        result = self.listed(False)
        self.assertEqual(len(result['jobs']), 4)
        self.assertEqual(result['waiting'], 0)


class BatchTests(unittest.TestCase):
    def test_reading_and_scoring_take_only_the_batch(self):
        import inspect
        from src.ai import enrich, score
        self.assertIn('only_ids', inspect.signature(enrich.run).parameters)
        self.assertIn('only_ids', inspect.signature(score.run).parameters)
        source = open('src/daily.py').read()
        import re
        read = len(re.findall(r'enrich\.run\([^\n]*only_ids=batch', source))
        scored = len(re.findall(r'score\.run\((?:[^()]|\([^()]*\))*only_ids=batch', source, re.S))
        self.assertGreaterEqual(read, 2, 'the first batch and the top-ups')
        self.assertEqual(read, scored, 'every batch read is then scored')


if __name__ == '__main__':
    unittest.main()
