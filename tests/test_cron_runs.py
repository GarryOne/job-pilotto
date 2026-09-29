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
        self.assertEqual(cron_runs.report_lines({'mode': 'add', 'warnings': []})[0], 'Logged activity done (AI cost $0.000)')
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
        self.assertEqual(props['Run']['title'][0]['text']['content'], '2026-09-26 10:00 · Jobs check')  # local time, as Started shows it
        self.assertEqual(props['Status']['select']['name'], 'Warnings')  # one feed failed
        self.assertEqual(props['AI cost (USD)']['number'], 0.034)
        self.assertNotIn('Cost kits (USD)', props)  # retired: each step's cost is on the page
        self.assertEqual(props['Scored']['number'], 2)
        self.assertEqual(props['Top new score']['number'], 88)
        self.assertEqual(props['Tokens (total)']['number'], 8000 + 1200 + 6000 + 900 + 3000)
        self.assertEqual(children[0]['type'], 'heading_3')

    def test_a_one_off_run_fills_only_what_applies_to_it(self):
        run = {'mode': 'prep', 'started_at': '2026-09-29T14:02:00+00:00', 'trigger': 'Mac (you)', 'warnings': [], 'seconds': 73,
               'subject': 'Huxley', 'application': 'app-page-1', 'headline': 'Huxley · Principal SRE: Prep kit ready',
               'interview': {'model': 'claude-sonnet-5', 'usd': 0.0475, 'tokens_in': 10486, 'tokens_out': 3148}}
        props, children = cron_runs.run_page(run)
        self.assertEqual(props['Run']['title'][0]['text']['content'], '2026-09-29 16:02 · Interview prep kit · Huxley')
        for name in ('Feeds', 'New jobs', 'Closed stale', 'Emails', 'Updates', 'Kits', 'Scored'):
            self.assertIsNone(props[name]['number'], name)  # another kind's column: empty, not 0
        self.assertEqual(props['Application'], {'relation': [{'id': 'app-page-1'}]})
        self.assertEqual(props['AI cost (USD)']['number'], 0.0475)
        stages = [c['bulleted_list_item']['rich_text'][0]['text']['content'] for c in children if c['type'] == 'bulleted_list_item']
        self.assertTrue(any('$0.0475' in line for line in stages), stages)  # the step's cost, on the page
        self.assertFalse(any('0 of 0' in line for line in stages), stages)

    def test_a_gmail_check_fills_its_own_columns(self):
        props, _ = cron_runs.run_page({'mode': 'mail', 'started_at': '2026-09-29T12:19:00+00:00', 'warnings': [],
                                       'mail': {'done': 4, 'usd': 0.0039}, 'updates': ['Reply received · Acme']})
        self.assertEqual((props['Emails']['number'], props['Updates']['number']), (4, 1))
        self.assertIsNone(props['Feeds']['number'])
        self.assertNotIn('Application', props)

    def test_a_column_the_workspace_lacks_yet_is_dropped_not_the_row(self):
        sent = []
        class Tracker:
            def _request(self, method, path, body):
                if 'Updates' in body['properties']:
                    raise RuntimeError('Notion 400: validation_error: Updates is not a property that exists.')
                sent.append(body)
                return {'url': 'https://notion.so/row'}
        url = cron_runs.log_run(Tracker(), {'mode': 'mail', 'started_at': '2026-09-29T16:00:00+00:00', 'warnings': [],
                                            'mail': {'done': 2}, 'updates': []})
        self.assertEqual(url, 'https://notion.so/row')
        self.assertEqual(sent[0]['properties']['Emails'], {'number': 2})  # the rest of the row is written

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


class PlainResultTest(unittest.TestCase):
    def test_a_link_keeps_its_address_so_the_app_can_open_the_job(self):
        from src.notion import cron_runs
        html = '1. <a href="https://jobs.ch/1?a=1&amp;b=2">DevOps Engineer</a> · 🎯 <b>80</b>'
        self.assertEqual(cron_runs.plain(html), '1. DevOps Engineer (https://jobs.ch/1?a=1&b=2) · 🎯 80')

    def test_an_empty_brand_variable_falls_back_to_the_name(self):
        import importlib, os
        from unittest import mock
        with mock.patch.dict(os.environ, {'DIGEST_BRAND_NAME': ''}):
            from src import digest
            self.assertEqual(importlib.reload(digest).BRAND_NAME, 'Job Pilotto')
        importlib.reload(digest)
