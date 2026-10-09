"""The Interviews page's commands and the interview insights on this Mac's store: every desktop command
(`src.ai.interviews list|calendar|save|link|held|moved|cancelled|delete`, `src.ai.interview_insights refresh|step`) works
with JOB_PILOTTO_STORE=sqlite and prints the JSON shape the app reads; the insights' fingerprint is the one Notion's rows gave
(a changed digest would make every Notion user's insight look outdated and refresh it, paid); the insight command runs without
Notion. Guards src/ai/interviews.py, interviews_apps.py, interview_insights.py, daily_modes.insight_mode."""
import hashlib
import io
import json
import os
import shutil
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

from src.ai import interview_insights as ii
from src.ai import interviews
from src.notion.ledger import plain
from src.stores import sqlite
from tests.interview_insights_fakes import ONE, interview, recs
from tests.interviews_fixtures import SPOKEN


class OnThisMac(unittest.TestCase):
    """A temporary SQLite store chosen as the active one, with one job at Interview scheduled."""
    def setUp(self):
        folder = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, folder, True)
        self.folder = folder
        self.env = {'JOB_PILOTTO_STORE': 'sqlite', 'JOB_PILOTTO_DATA_DIR': str(folder)}
        patcher = mock.patch.dict(os.environ, self.env)
        patcher.start()
        self.addCleanup(patcher.stop)
        os.environ.pop('NOTION_TOKEN', None)
        self.stores = sqlite.open_store(self.env)
        self.job = self.stores.applications.create({'url': 'https://x.test/g-1', 'title': 'SRE', 'company': 'Grafana Labs',
                                                    'location': 'Zürich', 'next_interview': '2026-09-26T06:30:00Z'}, 'Interview scheduled')

    def call(self, module, *argv):
        out = io.StringIO()
        with redirect_stdout(out), mock.patch('src.notion.client.Tracker.from_env', return_value=None):
            code = module.main(list(argv))
        return code, json.loads(out.getvalue().strip().splitlines()[-1])


class SqliteCommandTests(OnThisMac):
    def test_every_interviews_command_works_on_this_macs_store(self):
        transcript = self.folder / 'call.txt'
        transcript.write_text(SPOKEN, encoding='utf-8')
        code, saved = self.call(interviews, 'save', str(transcript), '--title', 'Grafana, round 1', '--job', 'https://x.test/g-1')
        self.assertEqual((code, saved['ok'], saved['url'], len(saved['id'])), (0, True, '', 32))
        code, listed = self.call(interviews, 'list')
        self.assertEqual(set(listed), {'ok', 'interviews', 'insight'})
        [row] = listed['interviews']
        self.assertEqual(set(row), {'id', 'url', 'title', 'date', 'input', 'overall', 'round', 'next_step', 'application', 'place'})
        self.assertEqual((row['title'], row['application'], row['place']), ('Grafana, round 1', [self.job['id']],
                                                                            {'location': 'Zürich', 'work_mode': ''}))
        self.assertEqual(self.call(interviews, 'calendar')[1]['interviews'][0]['place'], {})
        self.assertEqual(self.call(interviews, 'link', saved['id'])[1], {'ok': True, 'application': None})
        self.assertEqual(self.call(interviews, 'link', saved['id'], '--job', 'https://x.test/g-1')[1]['application'], self.job['id'])
        code, held = self.call(interviews, 'held', self.job['id'], '--notes', 'They asked about on-call and Postgres failover in depth.')
        self.assertEqual((held['ok'], held['review'], set(held)), (True, True, {'ok', 'id', 'url', 'stage', 'review'}))
        self.assertEqual(self.call(interviews, 'moved', self.job['id'], '--at', '2026-10-03T09:00:00+02:00')[1], {'ok': True})
        self.assertEqual(self.call(interviews, 'cancelled', self.job['id'])[1], {'ok': True})
        self.assertEqual(self.call(interviews, 'delete', saved['id'])[1], {'ok': True})
        self.assertEqual([r['id'] for r in self.call(interviews, 'list')[1]['interviews']], [held['id']])
        self.assertEqual(self.call(interviews, 'held', 'no-such-job')[1]['ok'], False)
        kinds = [e['kind'] for e in sqlite.open_store(self.env).events.list(app_id=self.job['id'])]
        self.assertEqual(kinds, ['Interviewing', 'Interview scheduled', 'Interview cancelled'])

    def test_the_insight_commands_work_on_this_macs_store(self):
        code, out = self.call(ii, 'refresh')
        self.assertEqual((code, out['ok'], out['status'], out['insight']), (0, True, 'none', None))
        code, out = self.call(ii, 'step', '--text', 'Practise failover')
        self.assertEqual((code, out), (1, {'ok': False, 'error': 'There are no interview insights yet.'}))

    def test_notion_chosen_but_not_connected_says_so(self):
        with mock.patch.dict(os.environ, {'JOB_PILOTTO_STORE': 'notion'}):
            self.assertEqual(self.call(interviews, 'list'), (1, {'ok': False, 'error': 'Connect Notion first: interviews are kept in 🎤 Interviews.'}))
            self.assertEqual(self.call(ii, 'refresh'), (1, {'ok': False, 'error': 'Connect Notion first'}))

    def test_the_insight_command_runs_without_notion(self):
        from types import SimpleNamespace
        from src import daily_modes
        args = SimpleNamespace(mode='insight', send=False, db=str(self.folder / 'jobs.sqlite'))
        with mock.patch.object(daily_modes.insights, 'run', return_value='Insight: not due') as run, \
                mock.patch.object(daily_modes, 'log_ai_run'), \
                mock.patch('sys.stdout', io.StringIO()):
            try:
                daily_modes.insight_mode(args, None)
            except SystemExit as stop:
                self.fail(f'the insight command needs Notion: {stop}')
        self.assertEqual(run.call_args.args[1].name, 'sqlite')  # the store is this Mac's, no Notion


class RunStoreGateTests(unittest.TestCase):
    def test_a_mode_stops_exactly_when_the_engine_had_no_notion_client_on_a_notion_store(self):
        """The interview and insight modes' gate, on the store alone: the four cases of the old `not tracker and chosen() == 'notion'`."""
        from src import daily_modes
        cases = [({}, 'sqlite'),                                                                     # no token: this Mac's store, runs
                 ({'JOB_PILOTTO_STORE': 'notion'}, None),                                          # Notion chosen, no token: stops
                 ({'NOTION_TOKEN': 'secret_x', 'JOB_PILOTTO_DISABLE': 'notion'}, None),           # Notion switched off: stops
                 ({'NOTION_TOKEN': 'secret_x', 'JOB_PILOTTO_DISABLE': 'notion', 'JOB_PILOTTO_STORE': 'sqlite'}, 'sqlite'),
                 ({'NOTION_TOKEN': 'secret_x'}, 'notion')]                                        # Notion connected: runs
        for env, expected in cases:
            with tempfile.TemporaryDirectory() as folder, \
                    mock.patch.dict(os.environ, {'JOB_PILOTTO_DATA_DIR': folder, **env}), self.subTest(env=env):
                for name in ('NOTION_TOKEN', 'JOB_PILOTTO_STORE', 'JOB_PILOTTO_DISABLE'):
                    if name not in env:
                        os.environ.pop(name, None)
                if expected is None:
                    with self.assertRaises(SystemExit) as stop:
                        daily_modes._run_store(None, '--mode insight requires NOTION_TOKEN')
                    self.assertEqual(str(stop.exception), '--mode insight requires NOTION_TOKEN')
                else:
                    self.assertEqual(daily_modes._run_store(None, 'x').name, expected)


class ReviewCommandTests(OnThisMac):
    def test_a_review_runs_on_this_macs_store_without_notion(self):
        from types import SimpleNamespace
        from src import daily_modes
        from tests.interviews_fixtures import FakeClient
        transcript = self.folder / 'call.txt'
        transcript.write_text(SPOKEN, encoding='utf-8')
        args = SimpleNamespace(file=str(transcript), note='Grafana, round 1', send=False, job='https://x.test/g-1', interview=None,
                               log_run=False)
        out = io.StringIO()
        with mock.patch('src.ai.engine.client', return_value=FakeClient()), redirect_stdout(out):
            try:
                self.assertEqual(daily_modes.interview_mode(args, None), 0)
            except SystemExit as stop:
                self.fail(f'a review needs Notion: {stop}')
        self.assertIn('Interview analysed (Grafana Labs', out.getvalue())
        [row] = sqlite.open_store(self.env).interviews.list()
        self.assertEqual((row['overall'], row['app_id']), ('positive', self.job['id']))
        self.assertEqual(sqlite.open_store(self.env).applications.get('https://x.test/g-1')['stage'], 'Interviewing')


class InsightRunTests(OnThisMac):
    def test_a_refresh_that_calls_the_ai_logs_its_run_on_this_macs_store(self):
        from tests.interview_insights_fakes import RESULT, FakeClient
        stores = sqlite.open_store(self.env)
        stores.interviews.save(None, {'app_id': self.job['id'], 'title': 'Grafana · Technical 1', 'overall': 'neutral',
                                      'round': 'Technical 1', 'at': '2026-09-20', 'review': 'Solid.\n\n### Weak spots\n\n- Postgres'})
        with mock.patch('src.ai.engine.client', return_value=FakeClient(RESULT)):
            code, out = self.call(ii, 'refresh')
        self.assertEqual((code, out['status']), (0, 'updated'))
        [run] = sqlite.open_store(self.env).cron_runs.list()
        self.assertEqual((run['kind'], run['status']), ('insight', 'OK'))  # today's word (cron_report.status)
        self.assertTrue(run['title'].endswith('Interview insights'), run['title'])
        self.assertGreater(run['stats']['ai_cost_usd'], 0)  # the budget guard sees it on this Mac's store


class FingerprintTests(unittest.TestCase):
    def test_the_digest_is_the_one_notions_rows_gave(self):
        rows = list(ONE) + [interview('iv-2', 'Screen', 'positive', '2026-09-25'), interview('iv-3', '', 'negative', '')]
        rows[1]['properties']['Questions'] = {'type': 'number', 'number': 4}
        rows[2]['properties']['Date'] = {'type': 'date', 'date': None}
        old = sorted([r['id'].replace('-', ''), [plain(r['properties'].get(c)) for c in ii.FINGERPRINT_COLUMNS],
                      sorted(l['id'].replace('-', '') for l in (r['properties'].get('Application') or {}).get('relation', []))]
                     for r in rows)
        before = hashlib.sha256(json.dumps(old, ensure_ascii=False, default=str).encode()).hexdigest()[:24]
        self.assertEqual(ii.fingerprint(recs(None, rows)), before)


if __name__ == '__main__':
    unittest.main()
