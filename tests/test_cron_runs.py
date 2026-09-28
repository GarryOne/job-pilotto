from types import SimpleNamespace
import unittest

from src import daily
from src.ai import cost
from src.notion import cron_runs


def sample_run(**extra):
    run = {'mode': 'scheduled', 'started_at': '2026-09-26T08:00:05+00:00', 'trigger': 'Schedule',
           'warnings': [], 'feeds': 40, 'feed_errors': 1, 'failing_feeds': ['Acme'], 'new': 3, 'changed': 1,
           'closed_stale': 2, 'seconds': 95, 'run_url': 'https://github.com/o/r/actions/runs/1',
           'enrich': {'model': 'claude-haiku-4-5', 'pending': 4, 'done': 4, 'failed': 0,
                      'tokens_in': 8000, 'tokens_out': 1200, 'cache_read': 0, 'usd': 0.014},
           'score': {'model': 'claude-sonnet-5', 'pending': 3, 'done': 2, 'failed': 1,
                     'tokens_in': 6000, 'tokens_out': 900, 'cache_read': 3000, 'usd': 0.02},
           'top_new': [('Staff SRE', 'Grafana Labs', 88), ('Platform Engineer', 'DeepL', 74)],
           'telegram': 'sent 2 message(s), 3 new'}
    run.update(extra)
    return run


class CostTest(unittest.TestCase):
    def test_usd_counts_cache_reads_and_writes(self):
        usage = SimpleNamespace(input_tokens=1000, output_tokens=100, cache_read_input_tokens=2000,
                                cache_creation_input_tokens=400)
        expected = (1000 * 2 + 400 * 2 * 1.25 + 2000 * 0.20 + 100 * 10) / 1e6
        self.assertAlmostEqual(cost.usd('claude-sonnet-5', usage), expected)
        self.assertEqual(cost.usd('unknown-model', usage), 0)

    def test_add_is_a_no_op_without_stats(self):
        cost.add(None, 'claude-haiku-4-5', SimpleNamespace(input_tokens=1, output_tokens=1))


class ReportTest(unittest.TestCase):
    def test_a_one_off_job_never_gets_a_crawls_summary(self):
        self.assertEqual(cron_runs.report_lines({'mode': 'add', 'warnings': []})[0], 'Tracked application done (AI cost $0.000)')
        self.assertTrue(cron_runs.report_lines({'mode': 'weekly', 'headline': '9 applications sent', 'warnings': []})[0]
                        .startswith('9 applications sent'))
        self.assertTrue(cron_runs.report_lines({'mode': 'scheduled', 'warnings': []})[0].startswith('Quiet run'))

    def test_report_headline_and_highlights(self):
        lines = cron_runs.report_lines(sample_run())
        self.assertEqual(lines[0], '3 new and 1 changed job(s) from 40 feed(s); AI cost $0.034.')
        self.assertIn('Top new match: Staff SRE at Grafana Labs (score 88).', lines)
        self.assertIn('Scored: 1 of 3 call(s) failed.', lines)
        self.assertIn('1 feed(s) failed: Acme.', lines)

    def test_quiet_run(self):
        run = {'mode': 'scheduled', 'started_at': '2026-09-26T08:00:05+00:00', 'warnings': [], 'feeds': 40}
        self.assertTrue(cron_runs.report_lines(run)[0].startswith('Quiet run'))
        self.assertEqual(cron_runs.status(run), 'Quiet')

    def test_page_properties(self):
        props, children = cron_runs.run_page(sample_run())
        self.assertEqual(props['Run']['title'][0]['text']['content'], '2026-09-26 08:00 · scheduled')
        self.assertEqual(props['Status']['select']['name'], 'Warnings')  # one feed failed
        self.assertEqual(props['AI cost (USD)']['number'], 0.034)
        self.assertEqual(props['Cost kits (USD)']['number'], 0)
        self.assertEqual(props['Scored']['number'], 2)
        self.assertEqual(props['Top new score']['number'], 88)
        self.assertEqual(props['Tokens (total)']['number'], 8000 + 1200 + 6000 + 900 + 3000)
        self.assertEqual(children[0]['type'], 'heading_3')

    def test_log_run_never_raises(self):
        class Broken:
            def _request(self, *args):
                raise RuntimeError('Notion down')
        self.assertIsNone(cron_runs.log_run(Broken(), sample_run()))

    def test_log_run_posts_to_the_cron_database(self):
        calls = []
        class Tracker:
            def _request(self, method, path, body):
                calls.append(body)
                return {'url': 'https://notion.so/row'}
        self.assertEqual(cron_runs.log_run(Tracker(), sample_run()), 'https://notion.so/row')
        self.assertEqual(calls[0]['parent']['database_id'], cron_runs.CRON_RUNS_DATABASE_ID)


class DailyHelpersTest(unittest.TestCase):
    def test_crawl_counts(self):
        report = {'sources': [{'company': 'A', 'ok': True}, {'company': 'B', 'ok': False}]}
        counts = daily.crawl_counts(report, ['new', 'seen', 'changed', 'new'])
        self.assertEqual((counts['feeds'], counts['feed_errors'], counts['new'], counts['changed']), (2, 1, 2, 1))
        self.assertEqual(counts['failing_feeds'], ['B'])

    def test_top_new_only_counts_jobs_first_seen_this_run(self):
        report = {'jobs': [{'url': 'u1', 'status': 'new'}, {'url': 'u2', 'status': 'seen'}]}
        scored = [{'url': 'u1', 'title': 'SRE', 'company': 'A', 'fit': {'score': 70}},
                  {'url': 'u2', 'title': 'Old', 'company': 'B', 'fit': {'score': 95}}]
        self.assertEqual(daily.top_new(report, scored), [('SRE', 'A', 70)])

    def test_trigger_from_github_event(self):
        import os
        from unittest import mock
        with mock.patch.dict(os.environ, {'GITHUB_EVENT_NAME': 'workflow_dispatch', 'GITHUB_RUN_ID': '7',
                                          'GITHUB_REPOSITORY': 'o/r'}):
            run = daily.new_cron_run('run')
        self.assertEqual(run['trigger'], 'Manual')
        self.assertEqual(run['run_url'], 'https://github.com/o/r/actions/runs/7')


if __name__ == '__main__':
    unittest.main()
