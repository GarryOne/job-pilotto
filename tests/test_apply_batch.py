"""Apply with Claude / ChatGPT batches (src/ai/apply_batch.py) on the store: the memory store stands in for any adapter (sqlite on
this Mac, Notion), with the kit kept as its section (base.KIT_SECTION, read with base.kit_from)."""
import io
import json
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import apply_batch
from src.stores import base, memory

KIT = {'url': 'https://example.test/job/1', 'cover_letter': 'Dear team...',
       'answers': [{'question': 'Why us?', 'answer': 'Because.'}, {'question': 'Blank?', 'answer': ''}],
       'check_before_sending': ['Confirm salary expectation', 'Confirm sponsorship answer']}


def stores_with(jobs=(), matches=()):
    """jobs: (url, stage, kit or None, extra fields); matches: (url, score)."""
    stores = memory.open_store()
    for url, stage, kit_data, extra in jobs:
        record = stores.applications.create({'url': url, 'title': 'SRE', 'company': 'Acme', **extra}, stage)
        if kit_data:
            stores.applications.set_section(record['id'], base.KIT_SECTION, f"Kit\n\n```json\n{json.dumps(kit_data)}\n```\n")
    for url, score in matches:
        stores.matches.upsert({'url': url, 'title': 'SRE', 'fit': score})
    return stores


class BuildPromptTests(unittest.TestCase):
    def test_skips_blank_answers_and_includes_cover_letter_and_cv(self):
        prompt = apply_batch.build_prompt(KIT, '/tmp/cv.pdf')
        self.assertIn('Dear team...', prompt)
        self.assertIn('Why us?: Because.', prompt)
        self.assertNotIn('Blank?', prompt)
        self.assertIn('/tmp/cv.pdf', prompt)
        self.assertIn(KIT['url'], prompt)


class ReadyJobsTests(unittest.TestCase):
    def test_jobs_with_a_kit_come_with_it_and_nothing_is_marked(self):
        stores = stores_with([(KIT['url'], 'Kit ready', KIT, {}), ('https://example.test/job/2', 'Saved', None, {})])
        pairs = apply_batch.ready_jobs(stores, 5)
        self.assertEqual([(record['title'], kit_data['check_before_sending']) for record, kit_data in pairs],
                         [('SRE', KIT['check_before_sending'])])
        self.assertEqual(stores.applications.get(KIT['url'])['stage'], 'Kit ready')  # listing never marks Applying


def run_main(stores, *argv):
    out = io.StringIO()
    with mock.patch.object(apply_batch.notion.Tracker, 'from_env', return_value=None), \
            mock.patch.object(apply_batch, 'open_stores', return_value=stores), \
            mock.patch.object(sys, 'argv', ['apply_batch', *argv]), redirect_stdout(out):
        return apply_batch.main(), out.getvalue()


class HasKitTests(unittest.TestCase):
    """--has-kit gates Apply with Claude: no session starts for a job without a drafted kit."""

    def test_kit_drafted(self):
        stores = stores_with([(KIT['url'], 'Kit ready', KIT, {})])
        self.assertEqual(run_main(stores, '--has-kit', KIT['url'])[0], 0)
        self.assertEqual(stores.applications.get(KIT['url'])['stage'], 'Kit ready')

    def test_no_row_or_no_kit(self):
        url = 'https://www.jobs.ch/en/vacancies/detail/x/'
        code, text = run_main(stores_with(), '--has-kit', url)
        self.assertEqual(code, 1)
        self.assertIn('prepare a kit first', text)
        self.assertEqual(run_main(stores_with([(url, 'Saved', None, {})]), '--has-kit', url)[0], 1)


class MarkApplyingTests(unittest.TestCase):
    """--mark-applying (fire-and-forget from the app when a session starts) marks a tracked job; an untracked URL is said, not a KeyError."""

    def test_tracked_job_is_marked(self):
        stores = stores_with([(KIT['url'], 'Kit ready', KIT, {})])
        self.assertEqual(run_main(stores, '--mark-applying', KIT['url'])[0], 0)
        self.assertEqual(stores.applications.get(KIT['url'])['stage'], 'Applying')

    def test_untracked_url_is_left_alone(self):
        stores = stores_with()
        code, text = run_main(stores, '--mark-applying', 'https://boards.greenhouse.io/e2e/jobs/4001001')
        self.assertEqual((code, stores.applications.list()), (0, []))
        self.assertIn('not on the tracker', text)

    def test_mark_applied_never_writes_a_notion_that_is_not_the_store(self):
        with self.assertRaises(SystemExit):
            run_main(stores_with([(KIT['url'], 'Applying', KIT, {})]), '--mark-applied', KIT['url'])


class NextJobsTests(unittest.TestCase):
    """Apply to N with Claude: the best N jobs with a kit, picked from the records (no kit is opened), fast."""

    def test_best_scored_open_jobs_with_a_kit_without_opening_kits(self):
        stores = stores_with([('https://a', 'Kit ready', None, {}), ('https://b', 'Saved', None, {'next_step': '📝 Kit ready: review it'}),
                              ('https://c', 'Saved', None, {}), ('https://d', 'Kit ready', None, {}), ('https://e', 'Kit ready', None, {})],
                             [('https://a', 60), ('https://b', 90), ('https://d', 75), ('https://e', 80)])
        closed = {'https://e'}
        with mock.patch.object(stores.applications, 'section', side_effect=AssertionError('no kit is opened to pick the jobs')), \
                mock.patch.object(apply_batch, 'still_open', lambda s, url: url not in closed):
            self.assertEqual(apply_batch.unstarted_urls_by_score(stores, 2), ['https://b', 'https://d'])
            self.assertEqual(apply_batch.job_details('https://b')['title'], 'SRE')  # --details: the job's title and company

    def test_a_job_you_added_ranks_by_its_applications_fit_score(self):
        """Jobs added by hand or from a recruiter have no match: the fit score on their record counts."""
        stores = stores_with([('https://found', 'Kit ready', None, {'fit': 70}), ('https://added', 'Kit ready', None, {'fit': 88}),
                              ('https://unscored', 'Kit ready', None, {})], [('https://found', 70)])
        with mock.patch.object(apply_batch, 'still_open', lambda s, url: True):
            self.assertEqual(apply_batch.unstarted_urls_by_score(stores, 3), ['https://added', 'https://found', 'https://unscored'])


class TopUnpreparedTests(unittest.TestCase):
    def test_the_best_open_matches_without_a_kit_and_not_applied(self):
        stores = stores_with([('https://kitted', 'Kit ready', KIT, {}), ('https://applied', 'Applied', None, {})],
                             [('https://kitted', 95), ('https://applied', 90), ('https://free', 85), ('https://low', 40)])
        with mock.patch.object(apply_batch, 'still_open', lambda s, url: True):
            self.assertEqual(apply_batch.top_unprepared_urls(stores, 2), ['https://free', 'https://low'])


if __name__ == '__main__':
    unittest.main()
