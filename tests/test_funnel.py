import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.notion import funnel
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
        select = lambda name: {'type': 'select', 'select': {'name': name}}
        rich = lambda value: {'type': 'rich_text', 'rich_text': [{'plain_text': value}]}
        page = lambda pid, stage, **props: {'id': pid, 'properties': {'Stage': select(stage), **props}}

        class Tracker:
            database_id = 'apps'

            def query_database(self, database_id, query=None):
                if database_id == 'apps':
                    return [page('a', 'Applied', Source=select('Telegram')), page('b', 'Screening', Source=select('LinkedIn')),
                            page('c', 'Interviewing', Source=select('Job Pilotto app'), Notes=rich('Recruiter message (Email)')),
                            page('d', 'Rejected'),
                            page('e', 'Screening', Source=select('Job Pilotto app')), page('f', 'Screening', Source=select('Job Pilotto app'))]
                # e: applied, then the recruiter answered (outbound); f: the recruiter wrote first, then you applied (inbound).
                event = lambda pid, kind, at: {'properties': {'Kind': select(kind), 'At': {'date': {'start': at}},
                                                              'Application': {'relation': [{'id': pid}]}}}
                return [event('e', 'Recruiter lead', '2026-09-10'), event('e', 'Applied', '2026-09-01'),
                        event('f', 'Applied', '2026-09-10'), event('f', 'Recruiter lead', '2026-09-01')]
        apps = funnel.reached(Tracker())
        self.assertEqual(sorted(a['stage'] for a in apps), ['Applied', 'Rejected', 'Screening'])
        self.assertEqual(funnel.inbound_counts([app('Screening'), app('Rejected', 'Interviewing'), app('Recruiter lead')]),
                         {'contacted': 3, 'screening': 2, 'interviews': 1})

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


if __name__ == '__main__':
    unittest.main()


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
