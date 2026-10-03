"""The scout's AI step (src/ai/scout_ideas.py): what Claude is shown, how its answer is checked, and that a bad answer costs nothing."""
import json
import sqlite3
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import scout  # noqa: E402
from src.ai import scout_ideas  # noqa: E402

NOW = datetime(2026, 10, 3, 9, 0, tzinfo=timezone.utc)
SEARCH = {'role_keywords': ['site reliability', '\\bsre\\b'], 'locations': {'top_tier': ['\\bz[uü]rich\\b'], 'country_wide': ['\\bswitzerland\\b'], 'abroad': ['\\bberlin\\b']}}


class FakeClient:
    """Answers each call from a queue and keeps what it was asked."""

    def __init__(self, *answers, stop='end_turn'):
        self.answers, self.calls, self.stop = list(answers), [], stop
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        self.calls.append(kwargs)
        block = SimpleNamespace(type='text', text=json.dumps(self.answers.pop(0)))
        return SimpleNamespace(stop_reason=self.stop, content=[block], usage=SimpleNamespace(input_tokens=1, output_tokens=1))


def database():
    db = sqlite3.connect(':memory:')
    db.row_factory = sqlite3.Row
    scout.harvest(db, {'excluded': []}, [lambda: []])
    return db


def add(db, name, origin, status='pending'):
    db.execute("INSERT INTO scout_candidates (key, name, origin, priority, status, added_at) VALUES (?, ?, ?, 50, ?, 'x')", (scout.key_for(name), name, origin, status))


IDEAS = {'companies': [{'name': 'Acme AG', 'website': 'https://www.acme.ch/en', 'reason': 'Zurich SaaS'},
                       {'name': 'Linked Up', 'website': 'https://www.linkedin.com/company/x', 'reason': 'x'},
                       {'name': 'See https://evil.example', 'website': '', 'reason': 'x'},
                       {'name': 'Known GmbH', 'website': '', 'reason': 'x'}],
         'directories': [{'label': 'Members', 'url': 'https://assoc.example/members', 'why': 'member list'},
                         {'label': 'LinkedIn list', 'url': 'https://www.linkedin.com/x', 'why': 'x'}],
         'note': 'Tried banks and cloud consultancies: SwissDevJobs found most feeds.'}
PAGE = '<html><body><p>Our members</p><a href="https://beta.example/about">Beta SA</a><a href="https://www.gamma.ch">Gamma</a></body></html>'


class WhatClaudeSeesTests(unittest.TestCase):
    def test_yield_by_kind_of_source_and_last_ideas_with_their_outcome(self):
        db = database()
        for i in range(3):
            add(db, f'Hn{i}', 'Hacker News: (September 2026', 'found' if i == 0 else 'none')
        add(db, 'Swiss1', 'SwissDevJobs employer', 'found')
        add(db, 'Idea1', 'AI idea 2026-09-30', 'none')
        add(db, 'Idea2', 'AI idea 2026-09-30', 'pending')
        table = {row['origin']: row for row in scout_ideas.origin_yield(db)}
        self.assertEqual((table['Hacker News']['probed'], table['Hacker News']['found'], table['Hacker News']['share']), (3, 1, 0.33))
        self.assertEqual(table['SwissDevJobs employer']['share'], 1.0)
        self.assertEqual(scout_ideas.origin_yield(db)[0]['origin'], 'SwissDevJobs employer')   # best first
        self.assertEqual({i['name']: i['result'] for i in scout_ideas.last_ideas(db)}, {'Idea1': 'no public feed', 'Idea2': 'not probed yet'})

    def test_the_prompt_holds_roles_places_and_counts_but_no_regex_and_nothing_personal(self):
        db = database()
        data = scout_ideas.payload(db, SEARCH)
        self.assertEqual(data['roles'], ['site reliability', 'sre'])
        self.assertEqual(data['places']['top_tier'], ['zürich'])
        self.assertNotIn('\\b', json.dumps(data))
        self.assertEqual(set(data), {'roles', 'places', 'sources_so_far', 'feeds_found_examples', 'last_time', 'candidates_known'})


class CheckingTheAnswerTests(unittest.TestCase):
    def test_names_and_addresses_are_validated_and_known_companies_dropped(self):
        known = {scout.key_for('Known GmbH')}
        got = scout_ideas.clean_candidates(IDEAS['companies'], 'AI idea 2026-10-03', 78, known)
        self.assertEqual([(c['name'], c['website'], c['priority']) for c in got], [('Acme AG', 'https://www.acme.ch', 78), ('Linked Up', None, 78)])
        self.assertEqual(scout_ideas.origin_of('javascript:alert(1)'), '')
        self.assertEqual(scout_ideas.origin_of('http://127.0.0.1:8080/x'), '')
        self.assertEqual(scout_ideas.origin_of('acme.ch/careers'), 'https://acme.ch')

    def test_robots_txt_is_respected(self):
        deny = lambda url: 'User-agent: *\nDisallow: /members'
        self.assertFalse(scout_ideas.allowed('https://assoc.example/members', deny))
        self.assertTrue(scout_ideas.allowed('https://assoc.example/other', deny))
        self.assertTrue(scout_ideas.allowed('https://assoc.example/members', lambda url: (_ for _ in ()).throw(OSError('404'))))

    def test_page_text_lists_outside_links_and_drops_scripts(self):
        text = scout_ideas.page_text('<script>evil()</script><p>Hello</p>' + PAGE, 'https://assoc.example/members')
        self.assertIn('Beta SA -> https://beta.example', text)
        self.assertNotIn('evil()', text)


class RunTests(unittest.TestCase):
    def fetch(self, url):
        if url.endswith('robots.txt'):
            raise OSError('none')
        return PAGE

    def test_a_run_asks_reads_the_allowed_list_and_returns_candidates_with_their_origin(self):
        db = database()
        add(db, 'Known GmbH', 'x')
        client = FakeClient(IDEAS, {'companies': [{'name': 'Beta SA', 'website': 'https://beta.example'}, {'name': 'Gamma', 'website': ''}]})
        found = scout_ideas.run(db, SEARCH, client, NOW, get=self.fetch)
        names = {c['name']: c['origin'] for c in found['candidates']}
        self.assertEqual(names, {'Acme AG': 'AI idea 2026-10-03', 'Linked Up': 'AI idea 2026-10-03', 'Beta SA': 'AI list: assoc.example', 'Gamma': 'AI list: assoc.example'})
        self.assertEqual((found['companies'], found['directories'], found['note'][:6]), (2, 2, 'Tried '))
        self.assertEqual(len(client.calls), 2, 'the LinkedIn list is never fetched or read')
        self.assertIn('untrusted', client.calls[1]['system'][0]['text'])

    def test_it_runs_every_few_days_not_every_time(self):
        db = database()
        scout_ideas.run(db, SEARCH, FakeClient({'companies': [], 'directories': [], 'note': 'n'}), NOW)
        self.assertIsNone(scout_ideas.run(db, SEARCH, FakeClient(), NOW + timedelta(days=1)))
        self.assertIsNotNone(scout_ideas.run(db, SEARCH, FakeClient({'companies': [], 'directories': [], 'note': 'n'}), NOW + timedelta(days=4)))

    def test_a_cut_off_answer_raises_and_leaves_the_schedule_alone(self):
        db = database()
        with self.assertRaises(RuntimeError):
            scout_ideas.run(db, SEARCH, FakeClient(IDEAS, stop='max_tokens'), NOW)
        self.assertTrue(scout_ideas.due(db, NOW))

    def test_the_scout_carries_on_when_the_ideas_fail_and_when_they_are_off(self):
        db = database()
        import os
        from unittest import mock
        with mock.patch.dict(os.environ, {'ANTHROPIC_API_KEY': 'k', 'JOB_PILOTTO_DISABLE': ''}), \
                mock.patch.object(scout_ideas, 'run', side_effect=RuntimeError('boom')):
            self.assertIsNone(scout.ai_ideas(db))
        with mock.patch.dict(os.environ, {'ANTHROPIC_API_KEY': 'k', 'JOB_PILOTTO_DISABLE': 'scout_ai'}):
            self.assertIsNone(scout.ai_ideas(db))
        self.assertIsNone(scout.ai_ideas(db, harvest_sources=[]), 'a caller with its own sources gets no AI')

    def test_the_summary_tells_the_owner_what_was_tried(self):
        text = scout.telegram_summary({'checked': 0, 'harvested': 5, 'queued': 9, 'total_feeds': 3,
                                       'ideas': {'companies': 4, 'directories': 6, 'note': 'Tried banks.'}}, [])
        self.assertIn('New ideas', text)
        self.assertIn('4 companies and 6 from company lists', text)


if __name__ == '__main__':
    unittest.main()
