"""⏱️ Search runs in Notion as store records (src/stores/notion_cron_runs.py), beyond the contract: a run's page is today's
(the report's sections "Report", "Emails read", "Stages" as src/notion/cron_report.run_page writes them, the Result and the
Technical log as extra_blocks writes them), and an older workspace without the new columns keeps its rows."""
import unittest

from src.notion import cron_report
from src.stores import notion_blocks
from src.stores.notion_cron_runs import NotionCronRuns
from tests.test_cron_runs import sample_run
from tests.test_store_notion_blocks import runs as shown

ALL_COLUMNS = ('Run', 'Kind', 'Where', 'Status', 'Started', 'Finished', 'Summary', 'Trigger', 'Mode', 'Run URL', 'Application',
               'Run id', 'Progress', 'Duration (s)', 'AI cost (USD)', 'New jobs', 'Scored')


class RunsNotion:
    """One ⏱️ Search runs database in memory; `have`: its columns (Notion refuses a write naming another one)."""

    def __init__(self, have=ALL_COLUMNS):
        self.have, self.pages, self.blocks, self.count = set(have), {}, {}, 0

    def _check(self, props):
        missing = set(props) - self.have
        if missing:
            raise RuntimeError(f'{sorted(missing)[0]} is not a property that exists.')

    def _request(self, method, path, body=None):
        if method == 'GET' and path.startswith('databases/'):
            return {'properties': {name: {} for name in self.have}}
        if method == 'GET' and path.startswith('pages/'):
            return dict(self.pages[path.split('/')[1]])
        raise AssertionError(f'unexpected {method} {path}')

    def create_page(self, database_id, properties):
        self._check(properties)
        self.count += 1
        page = {'id': f'run-{self.count}', 'properties': dict(properties)}
        self.pages[page['id']], self.blocks[page['id']] = page, []
        return dict(page)

    def update_page(self, page_id, properties):
        self._check(properties)
        self.pages[page_id]['properties'].update(properties)
        return dict(self.pages[page_id])

    def append_blocks(self, page_id, blocks):
        for block in blocks:
            stored = dict(block, id=f'{page_id}-b{len(self.blocks[page_id])}')
            kids = stored[stored['type']].get('children') or []
            self.blocks[stored['id']] = [dict(k, id=f"{stored['id']}-c{i}") for i, k in enumerate(kids)]
            self.blocks[page_id].append(stored)

    def _children(self, block_id):
        return self.blocks.get(block_id, [])


def mail_run():
    return sample_run(mode='mail', emails=[
        {'subject': 'Your application at Acme', 'from': 'Jobs <jobs@acme.example>', 'at': '2026-09-26T07:00:00+00:00',
         'action': 'recorded', 'label': 'Rejection', 'changes': 'Stage → Rejected', 'link': 'https://mail.google.com/mail/u/0/#all/1'},
        {'subject': 'Interview *invite* [Grafana]', 'from': 'Anna <anna@grafana.example>', 'at': '2026-09-26T07:30:00+00:00',
         'action': 'asked', 'label': 'Interview', 'link': ''}], mail={'model': 'claude-haiku-4-5', 'pending': 2, 'done': 2, 'usd': 0.001})


class RunPageTests(unittest.TestCase):
    def finished(self, run, notion=None):
        notion = notion or RunsNotion()
        runs = NotionCronRuns(notion, 'runs-db')
        _, children = cron_report.run_page(run)
        report = notion_blocks.to_markdown(children)
        message = 'Your check\nfound 3 new jobs'
        row = runs.begin('search', 'github')
        runs.finish(row['id'], 'Done', summary='3 new jobs', report=report, result=message, log='line 1\nline 2')
        return notion, runs, row['id'], children, report, message

    def test_a_jobs_check_and_a_gmail_check_page_are_todays(self):
        for run in (sample_run(), mail_run()):
            notion, runs, run_id, children, report, message = self.finished(run)
            today = children + cron_report.extra_blocks([message], ['line 1', 'line 2'])
            self.assertEqual(shown(notion.blocks[run_id]), shown(today), run['mode'])
            self.assertEqual(runs.get(run_id)['report'], report)  # read back as written
        self.assertIn('Emails read', report)
        # The time is local (the machine's zone): CI runs in UTC, a Mac in Zurich; the line's shape is what matters.
        self.assertRegex(report, r'- \[Your application at Acme · Jobs · 26 Sep \d\d:\d\d — \\\[recorded\\\]')  # the email's line opens it
        self.assertIn('](https://mail.google.com/mail/u/0/#all/1)', report)

    def test_the_desktop_still_reads_the_report_bullets_and_the_result(self):
        notion, _, run_id, children, _, message = self.finished(sample_run())
        blocks = notion.blocks[run_id]
        bullets = [notion_blocks.plain_text(b['bulleted_list_item']['rich_text']) for b in blocks if b['type'] == 'bulleted_list_item']
        self.assertEqual(bullets, [notion_blocks.plain_text(b['bulleted_list_item']['rich_text']) for b in children
                                   if b['type'] == 'bulleted_list_item'])
        at = next(i for i, b in enumerate(blocks) if b['type'] == 'heading_3' and notion_blocks.plain_text(b['heading_3']['rich_text']) == 'Result')
        self.assertEqual([notion_blocks.plain_text(b['paragraph']['rich_text']) for b in blocks[at + 1:] if b['type'] == 'paragraph'],
                         message.split('\n'))

    def test_a_long_message_keeps_its_end_in_the_last_paragraph(self):
        notion, runs, run_id, *_ = self.finished(sample_run())
        long = '\n'.join(f'line {n}' for n in range(60))
        row = runs.begin('search', 'mac')
        runs.finish(row['id'], 'Done', result=long)
        paras = [b for b in notion.blocks[row['id']] if b['type'] == 'paragraph']
        self.assertEqual(len(paras), cron_report.RESULT_PARAS)
        self.assertTrue(notion_blocks.plain_text(paras[-1]['paragraph']['rich_text']).endswith('line 59'))

    def test_an_older_workspace_without_the_new_columns_keeps_its_rows(self):
        notion = RunsNotion(have=('Run', 'Status', 'Started', 'Summary', 'Trigger', 'Mode', 'Duration (s)'))
        runs = NotionCronRuns(notion, 'runs-db')
        row = runs.begin('search', 'github', {'trigger': 'Schedule', 'mode': 'scheduled', 'log_id': 'r-1'})
        runs.progress(row['id'], 'Reading 12 feeds')
        runs.touch(row['id'], {'duration_s': 300})
        runs.finish(row['id'], 'Done', summary='3 new jobs', stats={'new_jobs': 3, 'duration_s': 320}, title='2026-09-26 10:00 · Jobs check')
        props = notion.pages[row['id']]['properties']
        self.assertEqual(set(props) - set(notion.have), set())
        self.assertEqual((props['Status'], props['Duration (s)']), ({'select': {'name': 'Done'}}, {'number': 320}))
        self.assertEqual(notion_blocks.plain_text(props['Run']['title']), '2026-09-26 10:00 · Jobs check')


if __name__ == '__main__':
    unittest.main()
