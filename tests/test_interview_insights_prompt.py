"""Interview insights: what the prompt asks for and what reaches it (full review input, transcripts, fair evidence, staleness).
See also test_interview_insights.py."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import interview_insights as ii
from src.ai import interviews
from tests.model_stand_ins import rounds as setUpModule  # noqa: F401 (the model's answer)
from tests.interview_insights_fakes import NOW, interview, block, FakeNotion, FakeClient, ONE, PAGES, RESULT, env


class SharpInsights(unittest.TestCase):
    """A pattern is a behaviour that recurs across interviews, said plainly (the title); the concrete topics are its evidence
    (the detail and the quotes). Not a vague label ("gaps in specifics", 30 Sep 2026: "vague"), and not a single topic either
    ("can't name IoT protocols" is one finding, not a pattern)."""

    def test_the_prompt_asks_for_a_recurring_behaviour_with_named_instances(self):
        system = ii.SYSTEM
        self.assertIn('A pattern is a behaviour that recurs', system)
        self.assertIn('Name the instances', system)
        self.assertIn('IoT protocols', system)  # the worked example of an instance
        self.assertIn('a quote from each interview', system)
        self.assertIn('a single topic', system)  # one topic in one interview is an observation, not a pattern
        properties = ii.SCHEMA['properties']['patterns']['items']['properties']
        self.assertIn('recurring behaviour', properties['title']['description'])
        self.assertIn('never a vague label', properties['title']['description'])
        self.assertIn('two concrete instances', properties['pattern']['description'])

    def test_the_stored_format_is_at_least_version_4(self):
        self.assertGreaterEqual(ii.DATA_VERSION, 4)


class FullInput(unittest.TestCase):
    """What the insight reads (30 Sep 2026 review of the owner's two screens): the whole review, "Could count against you" and
    the ➖ questions with their "Better:" lines included, every signal kept, and the transcript of the newest interviews within
    a budget, so a pattern can be checked against what was actually said."""

    def page(self, transcript=''):
        blocks = [block('paragraph', 'Summary of the screen.'), block('heading_3', 'Signals from them')]
        blocks += [block('bulleted_list_item', f'Signal {n}') for n in range(1, 7)]
        blocks += [block('heading_3', 'Could count against you'), block('bulleted_list_item', 'Criticised the current employer to a recruiter'),
                   block('heading_3', 'Questions'), block('bulleted_list_item', '➖ [Customer bridge calls] What would you tell them? — Process → Better: a real example'),
                   block('bulleted_list_item', '⚠️ [IoT protocols] Name one — Could not → Better: name MQTT'),
                   block('bulleted_list_item', '✅ [Incident] OpenSearch — Clear'),
                   {'type': 'heading_3', 'id': 'tr-1', 'heading_3': {'rich_text': [{'plain_text': 'Transcript'}]}}]
        return blocks, {'tr-1': [block('paragraph', transcript)]} if transcript else {}

    def test_every_part_of_the_review_reaches_the_prompt(self):
        blocks, extra = self.page()
        fake = FakeNotion(list(ONE), {'iv-1': blocks, **extra})
        review = ii.review_text(fake, 'iv-1')
        self.assertEqual(review['against'], ['Criticised the current employer to a recruiter'])
        self.assertEqual([q.startswith('➖ [Customer bridge calls]') for q in review['mixed_answers']], [True])
        self.assertEqual(len(review['signals']), 6)
        view = ii.prompt_input(ii.gather(fake, list(ONE)))['by_round_type']['Technical'][0]
        self.assertEqual(len(view['signals']), 6)  # never cut to two: the client's pain points came fourth
        self.assertIn('could_count_against', view)
        self.assertIn('mixed_answers', view)

    def test_the_transcript_is_read_and_a_quote_from_it_counts_as_evidence(self):
        blocks, extra = self.page('Recruiter: can you name one or two? Candidate: For the protocol, I think TCP.')
        fake = FakeNotion(list(ONE), {'iv-1': blocks, **extra})
        items = ii.gather(fake, list(ONE))
        self.assertIn('For the protocol, I think TCP', items[0]['transcript'])
        self.assertIn('transcript', ii.prompt_input(items)['by_round_type']['Technical'][0])
        self.assertIn(ii._norm('For the protocol, I think TCP'), ii._source(items[0]))

    def test_transcripts_fit_a_budget_newest_first_and_a_missing_one_is_fine(self):
        long = 'x' * (ii.TRANSCRIPT_CHARS + 500)
        rows = [interview(f'iv-{n}', 'Technical', 'neutral', f'2026-09-{10 + n}') for n in range(1, 6)]
        pages = {}
        for row in rows:
            blocks, extra = self.page(long)
            extra = {f"{row['id']}-tr": extra['tr-1']}
            blocks[-1] = dict(blocks[-1], id=f"{row['id']}-tr")
            pages.update({row['id']: blocks, **extra})
        items = ii.gather(FakeNotion(rows, pages), rows)
        sizes = [len(item['transcript']) for item in items]
        self.assertLessEqual(max(sizes), ii.TRANSCRIPT_CHARS)
        self.assertLessEqual(sum(sizes), ii.TRANSCRIPT_BUDGET)
        self.assertGreater(sizes[-1], 0)  # the newest interview is always read
        self.assertEqual(sizes[0], 0)  # the oldest one waits when the budget is spent
        self.assertEqual(ii.gather(FakeNotion(list(ONE), PAGES), list(ONE))[0]['transcript'], '')  # no transcript toggle

    def test_the_prompt_merges_only_the_same_behaviour_and_checks_the_client_s_needs(self):
        self.assertIn('same behaviour', ii.SYSTEM)
        self.assertIn('what the interviewer said they need', ii.SYSTEM)
        self.assertIn('transcript', ii.SYSTEM)
        self.assertGreaterEqual(ii.DATA_VERSION, 5)


class FairPatterns(unittest.TestCase):
    """30 Sep 2026, the owner's two screens: the same moment backed two patterns, a question he was asked and couldn't
    answer was called a "volunteered" gap, strengths vanished, and the card said "he". One moment backs one pattern (code),
    the rest is the prompt's job."""

    def items(self):
        return ii.gather(FakeNotion(list(ONE), PAGES), list(ONE))

    def test_a_quote_backs_only_the_first_pattern_that_uses_it(self):
        quote = {'interview': 'I1', 'quote': 'Postgres failover answer lacked RTO numbers'}
        other = {'interview': 'I1', 'quote': 'Clear Kubernetes upgrade process'}
        result = {'headline': 'h', 'confidence': 'low', 'next_steps': [], 'patterns': [
            {'round_type': 'Technical', 'title': 'A', 'kind': 'weakness', 'pattern': 'first', 'evidence': [quote]},
            {'round_type': 'Technical', 'title': 'B', 'kind': 'weakness', 'pattern': 'reuses it only', 'evidence': [quote]},
            {'round_type': 'Technical', 'title': 'C', 'kind': 'strength', 'pattern': 'reuses it and has its own', 'evidence': [quote, other]}]}
        stored = ii.validate(result, self.items())
        self.assertEqual([p['title'] for p in stored['patterns']], ['A', 'C'])  # B had nothing of its own: dropped
        self.assertEqual([e['quote'] for e in stored['patterns'][1]['evidence']], ['Clear Kubernetes upgrade process'])

    def test_the_prompt_separates_kinds_of_gap_keeps_strengths_and_speaks_to_you(self):
        system = ii.SYSTEM
        for rule in ('knowledge gap', 'volunteered', 'delivery', 'one pattern only', 'at least one strength', 'Address the candidate as "you"',
                     'check the transcript'):
            self.assertIn(rule, system, rule)
        self.assertEqual(ii.DATA_VERSION, 6)


class Staleness(unittest.TestCase):
    """The card says when a review changed after the insight was written (Review again changes a review but doesn't refresh
    the insight; a GitHub review writes the insight after the review): saved() compares the stored input with the rows now."""

    def test_saved_says_stale_when_a_review_changed_since(self):
        fake = FakeNotion(list(ONE), PAGES)
        a, b = env()
        with a, b:
            ii.update(fake, client=FakeClient(RESULT), now=NOW, budget_status=lambda t: {'level': 'ok'})
            self.assertFalse(ii.saved(fake)['outdated'])
            fake.rows[0]['properties']['Questions'] = {'type': 'number', 'number': 13}  # reviewed again: 13 questions now
            self.assertTrue(ii.saved(fake)['outdated'])


if __name__ == '__main__':
    unittest.main()
