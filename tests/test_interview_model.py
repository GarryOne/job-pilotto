"""Interview reviews and the insights built on them run on Opus (owner's decision, 30 Sep 2026): rare, judgment-heavy calls on
noisy transcripts. Every model the app calls is priced (an unpriced model would count as $0 and slip past the AI budget), a
thinking model gets room to answer, and a request Opus declines is answered once by Sonnet instead of failing."""
import json
import unittest
from types import SimpleNamespace

from src.ai import cost, interview_insights, interviews


def reply(stop='end_turn', text='{}'):
    return SimpleNamespace(stop_reason=stop, content=[SimpleNamespace(type='text', text=text)],
                           usage=SimpleNamespace(input_tokens=1000, output_tokens=500, cache_read_input_tokens=0, cache_creation_input_tokens=0))


class Client:
    def __init__(self, *replies):
        self.replies, self.calls = list(replies), []
        self.messages = self

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return self.replies.pop(0)


class InterviewModel(unittest.TestCase):
    def test_reviews_and_insights_use_opus_with_room_to_think(self):
        self.assertEqual(interviews.DEFAULT_MODEL, 'claude-opus-5-5')
        self.assertEqual(interview_insights.model(), 'claude-opus-5-5')
        client = Client(reply(text=json.dumps({'ok': True})))
        interviews.analyse(client, interviews.DEFAULT_MODEL, '', [], '', 'transcript')
        self.assertGreaterEqual(client.calls[0]['max_tokens'], 16000)

    def test_every_model_the_app_calls_is_priced(self):
        for model in (interviews.DEFAULT_MODEL, interviews.FALLBACK_MODEL, 'claude-sonnet-5', 'claude-haiku-4-5'):
            self.assertIn(model, cost.PRICES, model)
        self.assertEqual(cost.PRICES['claude-opus-5-5'], (4.00, 20.00, 0.20))

    def test_a_review_opus_declines_is_answered_by_sonnet_and_costed_at_its_price(self):
        client = Client(reply('refusal'), reply(text=json.dumps({'ok': True})))
        result, usage, used = interviews.analyse(client, 'claude-opus-5-5', '', [], '', 'transcript')
        self.assertEqual((result, used), ({'ok': True}, interviews.FALLBACK_MODEL))
        self.assertEqual([c['model'] for c in client.calls], ['claude-opus-5-5', interviews.FALLBACK_MODEL])

    def test_insights_fall_back_the_same_way_and_a_second_refusal_is_an_error(self):
        client = Client(reply('refusal'), reply(text=json.dumps({'nothing_useful': True})))
        result, usage, used = interview_insights.generate(client, 'claude-opus-5-5', [])
        self.assertEqual(used, interviews.FALLBACK_MODEL)
        with self.assertRaisesRegex(RuntimeError, 'refusal'):
            interview_insights.generate(Client(reply('refusal'), reply('refusal')), 'claude-opus-5-5', [])


if __name__ == '__main__':
    unittest.main()


class RunName(unittest.TestCase):
    def test_the_interview_insights_run_is_titled_interview_insights(self):
        from src.notion import cron_runs
        run = {'mode': 'insight', 'started_at': '2026-09-30T11:56:00+00:00', 'name': interview_insights.RUN_NAME}
        self.assertEqual(cron_runs.title(run), '2026-09-30 13:56 · Interview insights')
        self.assertEqual(cron_runs.title({'mode': 'insight', 'started_at': '2026-09-30T05:00:00+00:00'}), '2026-09-30 07:00 · Insight')
