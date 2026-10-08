import io
import json
import sys
import unittest
from datetime import date, datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import interview_insights as ii
from src.ai import insights, interviews; from tests.model_stand_ins import rounds as setUpModule  # noqa: E702,F401 (the model's answer)

NOW = datetime(2026, 9, 30, 12, 0, tzinfo=timezone.utc)


def text(value):
    return {'type': 'rich_text', 'rich_text': [{'plain_text': value}]}


def select(value):
    return {'type': 'select', 'select': {'name': value} if value else None}


def interview(page_id, round_, overall, date_, topics='', weak='', next_step='', app=None):
    props = {'Interview': {'type': 'title', 'title': [{'plain_text': f'Acme · {round_}'}]}, 'Round': text(round_),
             'Overall': select(overall), 'Topics': text(topics), 'Weak topics': text(weak), 'Next step': text(next_step),
             'Date': {'type': 'date', 'date': {'start': date_}},
             'Application': {'type': 'relation', 'relation': [{'id': app}] if app else []}}
    return {'id': page_id, 'url': f'https://notion.test/{page_id}', 'properties': props}


def block(kind, content):
    return {'type': kind, kind: {'rich_text': [{'plain_text': content}]}}


def review_blocks(summary, strengths=(), weak=(), practice=(), questions=()):
    blocks = [block('paragraph', '🔗 Job: Acme · SRE'), block('paragraph', summary)]
    for title, items in (('Strengths', strengths), ('Weak spots', weak), ('Practise before the next round', practice)):
        if items:
            blocks += [block('heading_3', title)] + [block('bulleted_list_item', i) for i in items]
    blocks += [block('heading_3', 'Questions')] + [block('bulleted_list_item', q) for q in questions]
    blocks += [block('heading_3', 'Transcript'), block('paragraph', 'SECRET TRANSCRIPT TEXT')]
    return blocks


class FakeNotion:
    """🎤 Interviews rows with their pages, the 💡 Insights database, and Applications pages."""

    def __init__(self, rows, pages):
        self.rows, self.pages, self.insights, self.writes = rows, pages, [], []

    def query_database(self, database_id, filter_=None):
        if database_id == 'interviews-db':
            return self.rows
        if database_id == 'insights-db':
            wanted = (filter_ or {}).get('select', {}).get('equals')
            return [r for r in self.insights if not wanted or r['properties']['Category']['select']['name'] == wanted]
        return []

    def _children(self, page_id):
        return self.pages.get(page_id, [])

    def _request(self, method, path, body=None):
        if method == 'GET':
            return {'properties': {'Company': text('Acme'), 'Job': {'type': 'title', 'title': [{'plain_text': 'SRE'}]}}}
        self.writes.append((method, path, body))
        stored = {name: _as_read(value) for name, value in body['properties'].items()}
        if method == 'POST':
            row = {'id': f'ins-{len(self.insights) + 1}', 'url': 'https://notion.test/ins', 'properties': stored,
                   'last_edited_time': NOW.isoformat()}
            self.insights.append(row)
            return row
        row = next(r for r in self.insights if path == f"pages/{r['id']}")
        row['properties'].update(stored)
        return row


def _as_read(value):
    """A property as written -> as Notion returns it (enough for plain())."""
    for kind in ('title', 'rich_text'):
        if kind in value:
            return {'type': kind, kind: [{'plain_text': t['text']['content']} for t in value[kind]]}
    if 'select' in value:
        return {'type': 'select', 'select': value['select']}
    if 'number' in value:
        return {'type': 'number', 'number': value['number']}
    if 'date' in value:
        return {'type': 'date', 'date': value['date']}
    return value


class FakeClient:
    def __init__(self, result):
        self.result, self.calls = result, []
        self.messages = self

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(stop_reason='end_turn', content=[SimpleNamespace(type='text', text=json.dumps(self.result))],
                               usage=SimpleNamespace(input_tokens=6000, output_tokens=1500, cache_read_input_tokens=0,
                                                     cache_creation_input_tokens=0))


ONE = [interview('iv-1', 'Technical 1', 'neutral', '2026-09-20', 'Kubernetes; Postgres', 'Postgres', 'System design next week', 'app-1')]
PAGES = {'iv-1': review_blocks('Solid on Kubernetes, vague on databases.', strengths=['Clear Kubernetes upgrade process'],
                               weak=['Postgres failover answer lacked RTO numbers'], practice=['Postgres HA with Patroni'],
                               questions=['⚠️ [Postgres] Explain failover — Vague', '✅ [Kubernetes] Upgrade? — Drain pools']),
         'iv-2': review_blocks('Good screen; salary question fumbled.', weak=['Postgres failover answer lacked RTO numbers again'],
                               practice=['Postgres HA with Patroni']),
         'iv-3': review_blocks('Recruiter liked the story.', strengths=['Motivation for SRE was clear'])}
RESULT = {'nothing_useful': False, 'headline': 'Database failover is your weak spot in technical rounds', 'confidence': 'high',
          'patterns': [{'round_type': 'Technical', 'pattern': 'Postgres failover answers lack numbers',
                        'evidence': [{'interview': 'I1', 'quote': 'Postgres failover answer lacked RTO numbers'},
                                     {'interview': 'I2', 'quote': 'Postgres failover answer lacked RTO numbers again'}]},
                       {'round_type': 'Technical', 'pattern': 'Invented pattern', 'evidence': [
                           {'interview': 'I1', 'quote': 'the interviewer hated your shoes'}, {'interview': 'I9', 'quote': 'Clear Kubernetes upgrade process'}]}],
          'next_steps': [{'action': 'Practise a Postgres failover story with RTO numbers', 'interviews': ['I1', 'I2']},
                         {'action': 'Something uncited', 'interviews': []}]}


def env():
    return mock.patch.multiple(interviews, INTERVIEWS_DATABASE_ID='interviews-db'), \
        mock.patch.dict(ii.os.environ, {'NOTION_INSIGHTS_DB': 'insights-db'})


class Input(unittest.TestCase):
    def test_round_types_keep_screens_technical_and_manager_rounds_apart(self):
        self.assertEqual(ii.round_type('Recruiter screen'), 'Recruiter screen')
        self.assertEqual(ii.round_type('Technical screen'), 'Technical')
        self.assertEqual(ii.round_type('System design'), 'Technical')
        self.assertEqual(ii.round_type('Hiring manager'), 'Hiring manager')
        self.assertEqual(ii.round_type('Delivery chat'), 'Other')  # "live" inside a word is not a live-coding round

    def test_only_reviewed_rows_and_their_review_are_read_never_the_transcript(self):
        rows = ONE + [interview('iv-x', 'Recruiter screen', '', '2026-09-21')]  # saved, not reviewed
        a, b = env()
        with a, b:
            fake = FakeNotion(rows, PAGES)
            items = ii.gather(fake, ii.reviewed_rows(fake))
        self.assertEqual([i['id'] for i in items], ['iv-1'])
        item = items[0]
        self.assertEqual((item['label'], item['round_type'], item['company'], item['outcome']), ('I1', 'Technical', 'Acme', 'neutral'))
        self.assertEqual(item['summary'], 'Solid on Kubernetes, vague on databases.')
        self.assertEqual(item['weak_answers'], ['⚠️ [Postgres] Explain failover — Vague'])
        self.assertEqual(item['topics'], ['Kubernetes', 'Postgres'])
        self.assertNotIn('SECRET', json.dumps(ii.prompt_input(items)))

    def test_the_prompt_groups_interviews_by_round_type(self):
        items = [{'label': 'I1', 'round_type': 'Technical'}, {'label': 'I2', 'round_type': 'Recruiter screen'}]
        full = lambda i: dict(i, date='', round='', company='', job='', outcome='', topics=[], weak_topics=[], next_step='',
                              summary='', strengths=[], weak_spots=[], practice=[], signals=[], weak_answers=[])
        grouped = ii.prompt_input([full(i) for i in items])['by_round_type']
        self.assertEqual(list(grouped), ['Recruiter screen', 'Technical'])

    def test_the_fingerprint_changes_with_a_review_not_with_order(self):
        two = ONE + [interview('iv-2', 'Technical 2', 'negative', '2026-09-25')]
        self.assertEqual(ii.fingerprint(two), ii.fingerprint(list(reversed(two))))
        changed = [ONE[0], interview('iv-2', 'Technical 2', 'positive', '2026-09-25')]
        self.assertNotEqual(ii.fingerprint(two), ii.fingerprint(changed))


class Honesty(unittest.TestCase):
    def items(self, n):
        rows = [ONE[0], interview('iv-2', 'Technical 2', 'negative', '2026-09-25', app='app-1'),
                interview('iv-3', 'Recruiter screen', 'positive', '2026-09-26')][:n]
        a, b = env()
        with a, b:
            return ii.gather(FakeNotion(rows, PAGES), rows)

    def test_one_interview_is_tentative_with_low_confidence(self):
        result = {**RESULT, 'patterns': [{'round_type': 'Technical', 'pattern': 'Postgres failover lacks numbers',
                                          'evidence': [{'interview': 'I1', 'quote': 'Postgres failover answer lacked RTO numbers'}]}],
                  'next_steps': [{'action': 'Practise failover', 'interviews': ['I1']}]}
        stored = ii.validate(result, self.items(1))
        self.assertEqual(stored['interviews'], 1)
        self.assertEqual(stored['confidence'], 'low')
        self.assertTrue(all(p['tentative'] for p in stored['patterns']))

    def test_a_pattern_needs_two_interviews_and_evidence_must_be_quoted_from_the_review(self):
        stored = ii.validate(RESULT, self.items(3))
        self.assertEqual([p['text'] for p in stored['patterns']], ['Postgres failover answers lack numbers'])  # invented one dropped
        pattern = stored['patterns'][0]
        self.assertFalse(pattern['tentative'])
        self.assertEqual(pattern['interviews'], ['iv-1', 'iv-2'])
        self.assertEqual([s['text'] for s in stored['next_steps']], ['Practise a Postgres failover story with RTO numbers'])
        # With a single interview behind it, the same pattern is tentative.
        one = {**RESULT, 'patterns': [dict(RESULT['patterns'][0], evidence=RESULT['patterns'][0]['evidence'][:1])]}
        self.assertTrue(ii.validate(one, self.items(3))['patterns'][0]['tentative'])
        self.assertEqual(ii.validate(one, self.items(3))['confidence'], 'low')  # no pattern backed by 2 interviews

    def test_nothing_useful_says_so_briefly(self):
        stored = ii.validate({'nothing_useful': False, 'headline': 'x', 'confidence': 'high', 'patterns': [], 'next_steps': []}, self.items(2))
        self.assertTrue(stored['nothing_useful'])
        self.assertIn('Nothing to conclude yet', stored['headline'])


class Update(unittest.TestCase):
    def run_update(self, fake, client, **kw):
        a, b = env()
        with a, b:
            return ii.update(fake, client=client, now=NOW, budget_status=lambda t: {'level': 'ok'}, **kw)

    def test_first_run_creates_the_row_then_an_unchanged_set_never_spends_again(self):
        rows = [ONE[0], interview('iv-2', 'Technical 2', 'negative', '2026-09-25', app='app-1')]
        fake, client, stats = FakeNotion(rows, PAGES), FakeClient(RESULT), {}
        out = self.run_update(fake, client, stats=stats)
        self.assertEqual(out['status'], 'updated')
        self.assertEqual(len(client.calls), 1)
        self.assertEqual(client.calls[0]['model'], interviews.DEFAULT_MODEL)  # the interview review's model
        self.assertGreater(stats['usd'], 0)
        self.assertEqual(len(fake.insights), 1)
        props = fake.insights[0]['properties']
        self.assertEqual(props['Category']['select']['name'], 'Interview patterns')
        self.assertEqual(props['Sample size']['number'], 2)
        data = json.loads(''.join(t['plain_text'] for t in props['Data']['rich_text']))
        self.assertEqual(data['patterns'][0]['interviews'], ['iv-1', 'iv-2'])

        again = self.run_update(fake, client)
        self.assertEqual(again['status'], 'unchanged')
        self.assertEqual(len(client.calls), 1)  # no second AI call for the same input
        self.assertEqual(len(fake.writes), 1)

    def test_a_new_review_updates_the_same_row(self):
        fake, client = FakeNotion(list(ONE), PAGES), FakeClient(RESULT)
        self.run_update(fake, client)
        fake.rows.append(interview('iv-2', 'Technical 2', 'negative', '2026-09-25'))
        self.assertEqual(self.run_update(fake, client)['status'], 'updated')
        self.assertEqual(len(fake.insights), 1)  # upserted, never a second row
        self.assertEqual([w[0] for w in fake.writes], ['POST', 'PATCH'])
        self.assertEqual(fake.insights[0]['properties']['Sample size']['number'], 2)

    def test_no_reviewed_interview_or_a_paused_budget_makes_no_call(self):
        client = FakeClient(RESULT)
        self.assertEqual(self.run_update(FakeNotion([interview('iv-x', 'Screen', '', '2026-09-21')], PAGES), client)['status'], 'none')
        a, b = env()
        with a, b:
            out = ii.update(FakeNotion(list(ONE), PAGES), client=client, now=NOW, budget_status=lambda t: {'level': 'pause', 'pct': 0.93})
        self.assertEqual(out['status'], 'paused')
        self.assertEqual(client.calls, [])

    def test_a_failure_after_the_review_never_fails_the_review(self):
        broken = FakeClient(RESULT)
        broken.create = mock.Mock(side_effect=RuntimeError('boom'))
        a, b = env()
        with a, b, mock.patch.object(ii.budget, 'status', return_value={'level': 'ok'}):
            line = ii.after_review(FakeNotion(list(ONE), PAGES), client=broken)
        self.assertIn('skipped', line)

    def test_saved_reads_the_row_for_the_app(self):
        fake = FakeNotion(list(ONE), PAGES)
        self.run_update(fake, FakeClient(RESULT))
        a, b = env()
        with a, b:
            shown = ii.saved(fake)
        self.assertEqual(shown['headline'], RESULT['headline'])
        self.assertEqual(shown['interviews'][0]['id'], 'iv-1')
        self.assertEqual(shown['sample'], 1)


class CardWords(unittest.TestCase):
    """What the redesigned card shows besides the sentences: a short title and icon kind per pattern, a title and keyword line
    per step, and a sentence under the headline. Older rows and answers without them still work."""

    def result(self):
        rich = json.loads(json.dumps(RESULT))
        rich['headline_detail'] = 'The same pattern showed in tenure and unblocking questions.'
        rich['patterns'][0].update(title='Answers become unstructured', kind='weakness')
        rich['next_steps'][0].update(title='Prepare three STAR stories', focus='Team unblocking • Manual intervention')
        return rich

    def stored(self, result):
        fake = FakeNotion(list(ONE), PAGES)
        a, b = env()
        with a, b:
            ii.update(fake, client=FakeClient(result), now=NOW, budget_status=lambda t: {'level': 'ok'})
            return ii.saved(fake)

    def test_the_new_words_are_stored_and_read_back(self):
        shown = self.stored(self.result())
        self.assertEqual(shown['headline_detail'], 'The same pattern showed in tenure and unblocking questions.')
        self.assertEqual((shown['patterns'][0]['title'], shown['patterns'][0]['kind']), ('Answers become unstructured', 'weakness'))
        self.assertEqual((shown['next_steps'][0]['title'], shown['next_steps'][0]['focus']),
                         ('Prepare three STAR stories', 'Team unblocking • Manual intervention'))

    def test_an_answer_without_them_still_stores_and_an_unknown_kind_is_a_plain_note(self):
        shown = self.stored(RESULT)
        self.assertEqual(shown['headline_detail'], '')
        self.assertEqual((shown['patterns'][0]['title'], shown['patterns'][0]['kind']), ('', 'note'))
        odd = self.result()
        odd['patterns'][0]['kind'] = 'catastrophe'
        self.assertEqual(self.stored(odd)['patterns'][0]['kind'], 'note')

    def test_the_model_is_asked_for_them(self):
        for name in ('headline_detail',):
            self.assertIn(name, ii.SCHEMA['required'])
        self.assertIn('title', ii.SCHEMA['properties']['patterns']['items']['required'])
        self.assertIn('kind', ii.SCHEMA['properties']['patterns']['items']['required'])
        self.assertIn('focus', ii.SCHEMA['properties']['next_steps']['items']['required'])


class OlderRows(unittest.TestCase):
    """An insight saved before the card's new words (titles, kinds, keyword lines) is regenerated once on Refresh, even when no
    review changed, so it fills them in; after that an unchanged set never spends again."""

    def test_saved_says_which_version_the_insight_is(self):
        fake, client = FakeNotion(list(ONE), PAGES), FakeClient(RESULT)
        a, b = env()
        with a, b:
            ii.update(fake, client=client, now=NOW, budget_status=lambda t: {'level': 'ok'})
            self.assertEqual(ii.saved(fake)['version'], ii.DATA_VERSION)
            data = json.loads(''.join(t['plain_text'] for t in fake.insights[0]['properties']['Data']['rich_text']))
            del data['v']
            fake.insights[0]['properties']['Data'] = {'type': 'rich_text', 'rich_text': [{'plain_text': json.dumps(data)}]}
            self.assertEqual(ii.saved(fake)['version'], 1)

    def test_a_row_without_the_new_words_is_regenerated_once(self):
        fake, client = FakeNotion(list(ONE), PAGES), FakeClient(RESULT)
        a, b = env()
        with a, b:
            ii.update(fake, client=client, now=NOW, budget_status=lambda t: {'level': 'ok'})
            data = json.loads(''.join(t['plain_text'] for t in fake.insights[0]['properties']['Data']['rich_text']))
            self.assertEqual(data['v'], ii.DATA_VERSION)
            del data['v']  # as saved before the card was redesigned
            fake.insights[0]['properties']['Data'] = {'type': 'rich_text', 'rich_text': [{'plain_text': json.dumps(data)}]}
            again = ii.update(fake, client=client, now=NOW, budget_status=lambda t: {'level': 'ok'})
            self.assertEqual((again['status'], len(client.calls)), ('updated', 2))
            self.assertEqual(ii.update(fake, client=client, now=NOW, budget_status=lambda t: {'level': 'ok'})['status'], 'unchanged')
            self.assertEqual(len(client.calls), 2)  # no third call


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


class TakeTurns(unittest.TestCase):
    """14:09 on 30 Sep 2026: two refreshes on this Mac (the app and the terminal) both saw an old insight and both paid
    Opus. They now take turns (a lock per data folder); the second then finds it current and makes no AI call."""

    def test_a_second_refresh_waits_for_the_first(self):
        import tempfile
        import threading
        from src import paths
        with tempfile.TemporaryDirectory() as folder:
            waited, order = [], []
            with paths.run_lock(folder, name='insights'):
                other = threading.Thread(target=lambda: self._second(paths, folder, waited, order))
                other.start()
                other.join(0.3)
                order.append('first done')
            other.join(2)
            self.assertEqual(waited, ['waiting'])
            self.assertEqual(order, ['first done', 'second ran'])
            self.assertTrue((__import__('pathlib').Path(folder) / 'insights.lock').exists())
            self.assertFalse((__import__('pathlib').Path(folder) / 'run.lock').exists())  # never blocks a jobs search

    @staticmethod
    def _second(paths, folder, waited, order):
        with paths.run_lock(folder, name='insights', on_wait=lambda: waited.append('waiting'), poll=0.05):
            order.append('second ran')

    def test_update_runs_under_the_insights_lock(self):
        import inspect
        self.assertIn("run_lock(name='insights'", inspect.getsource(ii.update))


class Ticks(unittest.TestCase):
    """The "Practice next" tick boxes: saved in the insight row's Data (Notion is the one copy), kept across a Refresh only
    for a step whose words are still there."""
    STEP = 'Practise a Postgres failover story with RTO numbers'

    def setUp(self):
        self.fake = FakeNotion(list(ONE), PAGES)
        self.client = FakeClient(RESULT)
        a, b = env()
        self.enter = (a, b)
        a.start(), b.start()
        self.addCleanup(a.stop), self.addCleanup(b.stop)
        ii.update(self.fake, client=self.client, now=NOW, budget_status=lambda t: {'level': 'ok'})

    def data(self):
        return json.loads(''.join(t['plain_text'] for t in self.fake.insights[0]['properties']['Data']['rich_text']))

    def test_a_step_key_ignores_case_spacing_and_punctuation(self):
        self.assertEqual(ii.step_key('  Practise a Postgres failover story, with RTO numbers! '), ii.step_key(self.STEP.lower()))

    def test_ticking_a_step_saves_it_in_the_row_and_saved_reads_it_back(self):
        out = ii.set_step_done(self.fake, self.STEP, True)
        self.assertEqual(out['done_steps'], [ii.step_key(self.STEP)])
        self.assertEqual(self.data()['done_steps'], [ii.step_key(self.STEP)])
        self.assertEqual(self.data()['patterns'][0]['interviews'], ['iv-1'])  # the rest of the row is untouched
        self.assertEqual(ii.saved(self.fake)['done_steps'], [ii.step_key(self.STEP)])
        ii.set_step_done(self.fake, self.STEP, False)
        self.assertEqual(self.data()['done_steps'], [])

    def test_saved_marks_each_step_done_or_not_for_the_window(self):
        self.assertEqual([step['done'] for step in ii.saved(self.fake)['next_steps']], [False])
        ii.set_step_done(self.fake, self.STEP, True)
        self.assertEqual([step['done'] for step in ii.saved(self.fake)['next_steps']], [True])

    def test_ticking_twice_keeps_one_entry_and_an_unknown_step_is_refused(self):
        ii.set_step_done(self.fake, self.STEP, True)
        ii.set_step_done(self.fake, self.STEP, True)
        self.assertEqual(len(self.data()['done_steps']), 1)
        with self.assertRaisesRegex(ValueError, 'not a step'):
            ii.set_step_done(self.fake, 'Something that is not there', True)

    def test_a_refresh_keeps_the_ticks_of_steps_that_are_still_there_and_drops_the_rest(self):
        ii.set_step_done(self.fake, self.STEP, True)
        self.fake.rows.append(interview('iv-2', 'Technical 2', 'negative', '2026-09-25'))
        again = dict(RESULT, next_steps=[RESULT['next_steps'][0], {'action': 'A brand new step', 'interviews': ['I1']}])
        ii.update(self.fake, client=FakeClient(again), now=NOW, budget_status=lambda t: {'level': 'ok'})
        self.assertEqual(self.data()['done_steps'], [ii.step_key(self.STEP)])
        gone = dict(RESULT, next_steps=[{'action': 'Only this now', 'interviews': ['I1']}])
        self.fake.rows.append(interview('iv-3', 'Screen', 'positive', '2026-09-26'))
        ii.update(self.fake, client=FakeClient(gone), now=NOW, budget_status=lambda t: {'level': 'ok'})
        self.assertEqual(self.data()['done_steps'], [])


class Neighbours(unittest.TestCase):
    def test_the_daily_insight_is_not_blocked_by_the_interview_patterns_row(self):
        row = lambda category: {'properties': {'Category': select(category)}}
        tracker = SimpleNamespace(query_database=lambda db, f=None: [row('Interview patterns')])
        self.assertFalse(insights.sent_today(tracker, date(2026, 9, 30)))
        tracker = SimpleNamespace(query_database=lambda db, f=None: [row('Interview patterns'), row('Skills')])
        self.assertTrue(insights.sent_today(tracker, date(2026, 9, 30)))

    def test_focus_does_not_show_it_as_the_page_insight(self):
        from src import focus
        patterns = {'id': 'p', 'url': '', 'created_time': '2026-09-30T10:00:00Z', 'properties': {
            'Insight': {'type': 'title', 'title': [{'plain_text': 'Interview patterns headline'}]},
            'Category': select('Interview patterns'), 'Date': {'type': 'date', 'date': {'start': '2026-09-30'}}}}
        built = focus.build([], [], [], now=NOW, insights=[patterns])
        self.assertIsNone(built['insight'])

    def test_a_review_run_updates_the_insights_and_counts_their_cost(self):
        from src import daily
        from tests.test_interviews import FakeTracker
        argv = ['daily', '--mode', 'interview', '--interview', 'iv-1']
        env_ = {k: v for k, v in daily.os.environ.items() if k not in ('TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID')}

        def after(tracker, stats=None):
            stats.update(usd=0.04, pending=1, done=1)
            return 'Interview insights updated'
        with mock.patch.object(sys, 'argv', argv), mock.patch.dict(daily.os.environ, env_, clear=True), \
                mock.patch.object(daily.telegram, 'keychain_token', return_value=None), \
                mock.patch.object(daily.notion.Tracker, 'from_env', return_value=FakeTracker([])), \
                mock.patch.object(daily, 'log_ai_run') as logged, \
                mock.patch.object(daily.interviews, 'run', return_value='Interview analysed (x) https://n.test/1'), \
                mock.patch.object(daily.interview_insights, 'after_review', side_effect=after) as hook, \
                mock.patch('sys.stdout', io.StringIO()):
            self.assertEqual(daily.main(), 0)
        hook.assert_called_once()
        self.assertEqual(logged.call_args.args[1]['insight']['usd'], 0.04)

    def test_a_workspace_without_the_interview_patterns_option_yet_reads_no_row_not_an_error(self):
        # Owner, 30 Sep 2026: the app ran the new code before its schema repair added the option; Notion answers a
        # select filter on an option it doesn't know with 400. That is "no row yet", and the rows are read unfiltered.
        import urllib.error

        class Missing(FakeNotion):
            def query_database(self, database_id, filter_=None):
                if database_id == 'insights-db' and filter_:
                    raise urllib.error.HTTPError('https://api.notion.com/v1/databases/x/query', 400, 'Bad Request', {}, None)
                return super().query_database(database_id, filter_)
        fake = Missing(list(ONE), PAGES)
        a, b = env()
        with a, b:
            self.assertIsNone(ii.saved(fake))
            fake.insights.append({'id': 'daily', 'url': '', 'last_edited_time': NOW.isoformat(),
                                  'properties': {'Category': select('Skills')}})
            self.assertIsNone(ii.existing(fake))
            fake.insights.append({'id': 'ins-9', 'url': '', 'last_edited_time': NOW.isoformat(),
                                  'properties': {'Category': select('Interview patterns'), 'Insight': text('h')}})
            self.assertEqual(ii.existing(fake)['id'], 'ins-9')

    def test_an_unreadable_insight_is_reported_with_the_list_never_instead_of_it(self):
        problems = []
        with mock.patch.object(ii, 'saved', side_effect=RuntimeError('HTTP Error 400: Bad Request')):
            self.assertIsNone(interviews.saved_insight(object(), problems))
        self.assertEqual(problems, ['RuntimeError: HTTP Error 400: Bad Request'])
        tracker = SimpleNamespace()
        with mock.patch.object(interviews.notion.Tracker, 'from_env', return_value=tracker), \
                mock.patch.object(interviews, 'listing', return_value=[{'id': 'iv-1'}]), \
                mock.patch.object(ii, 'saved', side_effect=RuntimeError('HTTP Error 400: Bad Request')), \
                mock.patch.object(interviews, 'INTERVIEWS_DATABASE_ID', 'interviews-db'), \
                mock.patch('sys.stdout', new_callable=io.StringIO) as out, mock.patch('sys.stderr', io.StringIO()):
            code = interviews.main(['list'])
        shown = json.loads(out.getvalue().strip().splitlines()[-1])
        self.assertEqual(code, 0)
        self.assertEqual(shown['interviews'], [{'id': 'iv-1'}])
        self.assertIsNone(shown['insight'])
        self.assertIn('400', shown['insight_error'])

    def test_the_interviews_list_carries_the_insight(self):
        with mock.patch.object(ii, 'saved', side_effect=RuntimeError('Notion down')):
            self.assertIsNone(interviews.saved_insight(object()))
        with mock.patch.object(ii, 'saved', return_value={'headline': 'h'}):
            self.assertEqual(interviews.saved_insight(object()), {'headline': 'h'})


class EffortTests(unittest.TestCase):
    def test_haiku_is_not_sent_an_effort_and_others_are(self):
        for model, expected in (('claude-haiku-4-5', None), ('claude-sonnet-5-5', 'medium')):
            client = FakeClient(RESULT)
            ii.generate(client, model, [])
            self.assertEqual(client.calls[0]['output_config'].get('effort'), expected, model)


if __name__ == '__main__':
    unittest.main()
