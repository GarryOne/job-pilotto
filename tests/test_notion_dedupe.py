"""One Job Matches row per job: duplicates are found by URL (ignoring tracking parameters and a trailing slash),
the fullest row is kept, and the sync merges copies it meets instead of adding more."""
import sqlite3
import unittest
from unittest import mock

from src.notion import dedupe, matches


def page(pid, url, status='Open', scored='2026-09-25', edited='2026-09-25T10:00:00.000Z'):
    return {'id': pid, 'url': f'https://notion.test/{pid}', 'created_time': '2026-09-25T05:00:00.000Z', 'last_edited_time': edited,
            'properties': {'Job URL': {'url': url}, 'Status': {'select': {'name': status}}, 'Scored': {'date': {'start': scored}},
                           'Job': {'title': [{'plain_text': 'SRE'}]}}}


class DedupeTests(unittest.TestCase):
    def test_links_told_apart_only_by_their_fragment_stay_apart(self):
        from src.notion.dedupe import normalize_url
        one, two = 'https://mail.google.com/mail/u/0/#all/1a0e4cf9ed538616', 'https://mail.google.com/mail/u/0/#all/1a0e86124ae7e2f5'
        self.assertNotEqual(normalize_url(one), normalize_url(two))
        self.assertNotEqual(normalize_url('https://www.linkedin.com/messaging/#jp-aa11'), normalize_url('https://www.linkedin.com/messaging/#jp-bb22'))
        self.assertEqual(normalize_url('https://boards.example.com/jobs/1#apply'), normalize_url('https://boards.example.com/jobs/1/'))

    def test_same_job_whatever_the_url_form(self):
        a = dedupe.normalize_url('https://Jobs.example.com/job/42/?utm_source=x&gh_src=y&lang=en')
        self.assertEqual(a, dedupe.normalize_url('https://jobs.example.com/job/42?lang=en'))
        self.assertNotEqual(a, dedupe.normalize_url('https://jobs.example.com/job/43?lang=en'))

    def test_the_row_with_a_decision_wins_then_the_latest_score(self):
        groups = dedupe.plan([page('a', 'https://x/1', 'Open', '2026-09-27'), page('b', 'https://x/1/', 'Applied', '2026-09-25'),
                              page('c', 'https://x/2', scored='2026-09-24'), page('d', 'https://x/2', scored='2026-09-26'),
                              page('e', 'https://x/3')])
        self.assertEqual([(g['keep']['id'], [p['id'] for p in g['drop']], g['why']) for g in groups],
                         [('b', ['a'], 'its status is Applied'), ('d', ['c'], 'scored most recently (2026-09-26)')])

    def test_the_sync_merges_copies_it_meets_and_creates_no_new_row(self):
        tracker = mock.Mock()
        tracker.query_database.return_value = [page('a', 'https://x/1', scored='2026-09-24'), page('b', 'https://x/1', scored='2026-09-26')]
        tracker.upsert_match.side_effect = lambda props, page_id: page_id or 'new'
        db = sqlite3.connect(':memory:')
        db.row_factory = sqlite3.Row
        job = {'url': 'https://x/1?utm_source=feed', 'title': 'SRE', 'company': 'Acme', 'location': 'Zurich',
               'fit': {'score': 70, 'tier': 'B', 'reason': 'r', 'strengths': [], 'gaps': [], 'confidence': 'high',
                       'components': {'role_fit': 1, 'location': 1, 'compensation': 1, 'growth': 1, 'risk': 1}}}
        matches.sync(db, tracker, [job])
        tracker.trash_page.assert_called_once_with('a')
        self.assertEqual(tracker.upsert_match.call_args.args[1], 'b')  # updated the kept row, created nothing


if __name__ == '__main__':
    unittest.main()
