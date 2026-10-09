import sys
import shutil
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.notion import funnel
from tests import notion_stand_in
from src.notion.ledger import REPLY as REPLY_KIND


def app(stage, *kinds):
    return {'stage': stage, 'seen': set(kinds) | {stage}}


class FunnelTest(unittest.TestCase):
    def test_steps_count_what_each_application_reached(self):
        apps = ([app('Kit ready')] * 4 + [app('Confirmation received', 'Applied')] * 3
                + [app('Rejected', 'Applied')] * 2 + [app('Screening', 'Applied', 'Reply received')])
        steps = {s['step']: s for s in funnel.funnel(apps)}
        self.assertEqual(steps['📝 Prepared']['reached'], 10)
        self.assertEqual(steps['📨 Applied']['reached'], 6)
        self.assertEqual(steps['💬 Human reply']['reached'], 1)  # the 2 rejections alone are no human reply
        self.assertEqual(steps['📞 Screening']['reached'], 1)
        self.assertAlmostEqual(steps['📨 Applied']['conversion'], 0.6)
        self.assertEqual(steps['📨 Applied']['waiting'], 3)  # confirmation received, no human yet
        self.assertEqual(steps['📞 Screening']['waiting'], 1)

    def test_a_rejection_counts_as_a_human_reply_only_after_a_reply_or_a_screening(self):
        steps = {s['step']: s['reached'] for s in funnel.funnel([app('Rejected', 'Applied'), app('Rejected', 'Applied', REPLY_KIND),
                                                                app('Rejected', 'Applied', 'Screening')])}
        self.assertEqual(steps['💬 Human reply'], 2)

    def test_rejection_after_an_interview_still_counts_the_interview(self):
        steps = {s['step']: s for s in funnel.funnel([app('Rejected', 'Applied', 'Screening', 'Interviewing')])}
        self.assertEqual(steps['🧑‍💻 Interviews']['reached'], 1)
        self.assertEqual(steps['🧑‍💻 Interviews']['waiting'], 0)

    def test_focus_needs_enough_decided_applications(self):
        few = funnel.funnel([app('No response', 'Applied')] * 3 + [app('Kit ready')])
        self.assertIsNone(funnel.focus(few))
        self.assertIn('Too early', ' '.join(funnel.summary(few)))
        backlog = funnel.funnel([app('Applied')] * 2 + [app('Kit ready')] * 6)
        self.assertIn('volume: 6 kits', ' '.join(funnel.summary(backlog)))
        many = funnel.funnel([app('No response', 'Applied')] * 9 + [app('Rejected', 'Applied')])
        self.assertEqual(funnel.focus(many)['step'], '💬 Human reply')
        self.assertIn('Improve 💬 Human reply', funnel.summary(many)[0])

    def test_the_pipeline_page_funnel_leaves_inbound_out(self):
        from src.stores import memory
        stores = memory.open_store()
        made = {}
        for key, stage, extra in (('a', 'Applied', {'source': 'Telegram'}), ('b', 'Screening', {'source': 'LinkedIn'}),
                                  ('c', 'Interviewing', {'source': 'Job Pilotto app', 'notes': 'Recruiter message (Email)'}),
                                  ('d', 'Rejected', {}), ('e', 'Screening', {'source': 'Job Pilotto app'}),
                                  ('f', 'Screening', {'source': 'Job Pilotto app'})):
            made[key] = stores.applications.create({'url': f'https://x.test/{key}', **extra}, stage)['id']
        # e: applied, then the recruiter answered (outbound); f: the recruiter wrote first, then you applied (inbound).
        for key, kind, at in (('e', 'Recruiter lead', '2026-09-10'), ('e', 'Applied', '2026-09-01'),
                              ('f', 'Applied', '2026-09-10'), ('f', 'Recruiter lead', '2026-09-01')):
            stores.events.add(made[key], kind, at)
        apps = funnel.reached(stores)
        self.assertEqual(sorted(a['stage'] for a in apps), ['Applied', 'Rejected', 'Screening'])
        self.assertEqual(funnel.inbound_counts([app('Screening'), app('Rejected', 'Interviewing'), app('Recruiter lead')]),
                         {'contacted': 3, 'screening': 2, 'interviews': 1, 'offers': 0})
        steps = funnel.inbound_funnel([dict(app('Offer'), url='https://x.test/o'), dict(app('Recruiter lead'), url='')])
        self.assertEqual([(s['reached'], s['of_contacted'], s['urls']) for s in steps],
                         [(2, 1.0, ['https://x.test/o']), (1, 0.5, ['https://x.test/o']), (1, 0.5, ['https://x.test/o']),
                          (1, 0.5, ['https://x.test/o'])])
        self.assertIsNone(funnel.inbound_funnel([])[1]['of_contacted'])

    def test_blocks_are_a_table_and_a_callout(self):
        table, callout, note = funnel.blocks(funnel.funnel([app('Applied')]), '27 Sep 12:00')
        self.assertEqual(table['table']['table_width'], 5)
        self.assertEqual(len(table['table']['children']), len(funnel.STEPS) + 1)
        self.assertEqual(callout['type'], 'callout')
        self.assertIn('27 Sep', note['paragraph']['rich_text'][0]['text']['content'])


class ReplaceAfterHeadingTest(unittest.TestCase):
    def test_replaces_only_the_section(self):
        from src.notion.client import Tracker
        calls = []
        tracker = Tracker('t')
        heading = lambda i, t: {'id': i, 'type': 'heading_2', 'heading_2': {'rich_text': [{'plain_text': t}]}}
        para = lambda i: {'id': i, 'type': 'paragraph', 'paragraph': {'rich_text': []}}
        tracker._children = lambda _: [para('intro'), heading('h', '📈 Conversion'), para('old1'), para('old2'),
                                       heading('b', '🗂️ Board'), para('keep')]
        tracker._request = lambda method, path, body=None: calls.append((method, path, body))
        tracker.replace_after_heading('page', '📈 Conversion', [{'new': 1}])
        self.assertEqual([c[1] for c in calls if c[0] == 'DELETE'], ['blocks/old1', 'blocks/old2'])
        self.assertEqual(calls[-1], ('PATCH', 'blocks/page/children', {'children': [{'new': 1}], 'after': 'h'}))



class SameDefinitionsTests(unittest.TestCase):
    def test_the_jobs_counters_and_the_funnel_use_the_same_stage_sets(self):
        import re
        from pathlib import Path
        from src.notion import funnel, ledger
        js = (Path(__file__).resolve().parents[1] / 'desktop' / 'renderer' / 'jobs-view.js').read_text()
        stages = lambda name: set(re.findall(r"'([^']+)'", re.search(rf'export const {name} = new Set\(\[(.*?)\]\)', js, re.S)[1]))
        self.assertEqual(stages('SENT'), set(ledger.OUTCOME_STAGES))  # "Applied" = what the funnel counts as applied
        steps = {name: marks for name, marks, *_ in funnel.STEPS}
        self.assertEqual(stages('SCREENING') | stages('INTERVIEWS'), steps['📞 Screening'])
        self.assertEqual(stages('INTERVIEWS'), steps['🧑‍💻 Interviews'])


STEPS = funnel.funnel([app('Kit ready')] * 4 + [app('Rejected', 'Applied')] * 6 + [app('Screening', 'Applied', 'Reply received')])


class PipelinePageTest(unittest.TestCase):
    def test_a_store_without_a_pipeline_page_writes_nothing(self):
        from src.stores import memory
        self.assertFalse(funnel.write(memory.open_store(), STEPS, '09 Oct 20:00 UTC'))


def _direct(request, timeout=20):
    import urllib.request
    return urllib.request.urlopen(request, timeout=timeout)


@unittest.skipUnless(shutil.which('node'), 'node runs the Notion stand-in')
class PipelinePageOnNotionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        notion_stand_in.start(cls)

    @classmethod
    def tearDownClass(cls):
        notion_stand_in.stop(cls)

    def page(self, tracker, title):
        page = tracker._request('POST', 'pages', {'parent': {'page_id': 'stand-in-root'},
                                                   'properties': {'title': {'title': [{'text': {'content': title}}]}}})['id']
        tracker.append_blocks(page, [{'object': 'block', 'type': 'heading_2', 'heading_2': {'rich_text': [{'type': 'text', 'text': {'content': 'Intro'}}]}}])
        return page

    def test_the_store_writes_the_same_page_as_before(self):
        """D7: the Pipeline page through the notion adapter is block for block what the engine wrote with its tracker before."""
        from src.notion.client import Tracker
        from src.stores import notion as notion_store
        tracker = Tracker(self.token, opener=_direct)
        before, through_store = self.page(tracker, 'before'), self.page(tracker, 'store')
        tracker.replace_after_heading(before, funnel.HEADING, funnel.blocks(STEPS, '09 Oct 20:00 UTC'))   # the old funnel.write
        stores = notion_store.open_store({'NOTION_TOKEN': self.token, 'NOTION_PIPELINE_PAGE': through_store}, tracker=tracker)
        self.assertTrue(funnel.write(stores, STEPS, '09 Oct 20:00 UTC'))
        shape = lambda page: [{key: value for key, value in block.items() if key not in ('id', 'parent', 'created_time', 'last_edited_time')}
                              for block in tracker._children(page) if not block.get('archived')]
        self.assertGreater(len(shape(through_store)), 2)
        self.assertEqual(shape(through_store), shape(before))
        self.assertFalse(funnel.write(notion_store.open_store({'NOTION_TOKEN': self.token, 'NOTION_PIPELINE_PAGE': ''}, tracker=tracker),
                                      STEPS, 'x'), 'a workspace without a Pipeline page')

if __name__ == '__main__':
    unittest.main()


class FocusFunnelTest(unittest.TestCase):
    """Reports → Funnel (desktop renderer/reports-view.js): Focus's funnel carries each step's share of the previous one and the
    Pipeline page's own "Where to improve" lines (one copy: funnel.funnel and funnel.summary)."""

    def test_from_previous_and_the_improve_lines(self):
        from src import focus_state
        rows = [{'id': f'a{i}', 'stage': stage, 'url': f'https://x.test/{i}', 'source': 'Job Pilotto app'}
                for i, stage in enumerate(['Applied', 'Applied', 'Rejected', 'Kit ready'])]
        events = [{'app_id': 'a2', 'kind': REPLY_KIND, 'at': '2026-10-01'}]
        result = focus_state.funnel(rows, events)
        by = {step['step']: step for step in result['steps']}
        applied = next(step for name, step in by.items() if 'Applied' in name)
        self.assertEqual((applied['from'], applied['conversion']), (result['steps'][0]['reached'], applied['reached'] / result['steps'][0]['reached']))
        self.assertIsNone(result['steps'][0]['from'])
        self.assertTrue(result['summary'] and all(isinstance(line, str) for line in result['summary']))
