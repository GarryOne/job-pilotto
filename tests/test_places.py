"""Place words worked out by AI (src/places.py): what it asks, how the answer is checked, that it is asked once, and that a failure changes nothing.
tests/fixtures/places.json is real model output (Haiku, 5 Oct 2026) for Germany, UK, United States, Asia, Netherlands, Bavaria, DACH and Berlin."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import paths, places  # noqa: E402

FIXTURE = json.loads((Path(__file__).parent / 'fixtures' / 'places.json').read_text())


class FakeClient:
    def __init__(self, answer=None, error=None):
        self.answer, self.error, self.calls = answer, error, []
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        block = SimpleNamespace(type='text', text=json.dumps(self.answer))
        return SimpleNamespace(stop_reason='end_turn', content=[block], usage=SimpleNamespace(input_tokens=1, output_tokens=1))


def search(top=(), country=(), abroad=()):
    return {'locations': {'top_tier': list(top), 'country_wide': list(country), 'abroad': list(abroad)}}


ANSWER = {'places': [{'word': 'Germany', 'kind': 'country', 'names': ['Berlin', 'München', 'Munich', 'Frankfurt am Main']},
                     {'word': 'Berlin', 'kind': 'city', 'names': []}]}


class WhatIsAskedTests(unittest.TestCase):
    def test_only_place_words_that_may_need_it_are_asked(self):
        found = places.words_of(search(top=['berlin', '\\bz[uü]rich\\b', '/regex-like/', 'ab'], country=['germany', 'Romandie', 'switzerland'], abroad=['asia', 'germany']))
        self.assertEqual(found, ['berlin', 'zürich', 'germany', 'asia'])   # not a regex entry, a Swiss region word, a two-letter word, or twice

    def test_the_prompt_sends_the_words_and_nothing_else(self):
        with tempfile.TemporaryDirectory() as tmp:
            client = FakeClient(ANSWER)
            places.refresh(search(country=['germany'], top=['berlin']), client, Path(tmp) / 'places.json')
            sent = client.calls[0]
            self.assertEqual(json.loads(sent['messages'][0]['content'].split(': ', 1)[1]), ['berlin', 'germany'])
            self.assertEqual(sent['model'], places.MODEL)


class CacheTests(unittest.TestCase):
    def test_a_word_is_asked_once_and_kept(self):
        with tempfile.TemporaryDirectory() as tmp:
            file, client = Path(tmp) / 'sub' / 'places.json', FakeClient(ANSWER)
            self.assertEqual(places.refresh(search(country=['Germany']), client, file), 1)
            self.assertEqual(places.refresh(search(country=['germany']), client, file), 0)   # same word, other spelling of the case: nothing asked
            self.assertEqual(len(client.calls), 1)
            self.assertEqual(places.load(file)['germany']['kind'], 'country')

    def test_a_failure_changes_nothing_and_never_raises_out_of_the_crawl(self):
        with tempfile.TemporaryDirectory() as tmp:
            file = Path(tmp) / 'places.json'
            with self.assertRaises(RuntimeError):
                places.refresh(search(country=['germany']), FakeClient(error=RuntimeError('offline')), file)
            self.assertFalse(file.exists())
            self.assertEqual(places.load(file), {})
            self.assertEqual(places.load(Path(tmp) / 'missing.json'), {})
            file.write_text('{not json')
            self.assertEqual(places.load(file), {})


class CheckingTheAnswerTests(unittest.TestCase):
    def test_only_plain_place_names_are_kept(self):
        names = places.clean_names(['Berlin', 'berlin', 'Frankfurt am Main', "St. John's", 'Bad Homburg v. d. Höhe', 'a', 'x' * 61, '.*', '(?i)evil', 'Munich|Paris', 'Zürich\nBern',
                                    'Berlin <b>', '123', '', None, 'Saint-Étienne', "L'Aquila"])
        self.assertEqual(names, ['Berlin', 'Frankfurt am Main', "St. John's", 'Bad Homburg v. d. Höhe', 'Zürich Bern', 'Saint-Étienne', "L'Aquila"])
        self.assertEqual(len(places.clean_names([f'City{chr(97 + i % 26)}{chr(97 + i // 26)}' for i in range(300)])), places.MAX_NAMES)

    def test_a_pattern_in_a_name_can_never_match_everything(self):
        pattern = places.pattern(places.clean_names(['Berlin', 'Frankfurt am Main', "L'Aquila", 'St. Gallen']))
        import re
        regex = re.compile(pattern, re.I)
        self.assertTrue(regex.search('frankfurt am main, hesse') and regex.search("l'aquila") and regex.search('st. gallen'))
        self.assertFalse(regex.search('Munich') or regex.search('Berliner Bank') or regex.search('x'))

    def test_a_word_not_asked_about_in_the_answer_is_ignored(self):
        with tempfile.TemporaryDirectory() as tmp:
            file = Path(tmp) / 'places.json'
            answer = {'places': [{'word': 'Germany', 'kind': 'country', 'names': ['Berlin']}, {'word': 'Mars', 'kind': 'country', 'names': ['Olympus']},
                                 {'word': 'France', 'kind': 'planet', 'names': ['Paris']}]}
            places.refresh(search(country=['germany', 'france']), FakeClient(answer), file)
            self.assertEqual(list(places.load(file)), ['germany'])


class ExpandingTests(unittest.TestCase):
    def test_a_country_word_gains_its_cities_and_keeps_itself(self):
        out = places.expand(['germany', 'zurich'], FIXTURE)
        self.assertEqual(out[0], 'germany')
        self.assertTrue(out[1].startswith('(?:') and 'munich' in out[1])
        self.assertEqual(out[2], 'zurich')   # unknown to the cache: untouched

    def test_a_city_is_left_as_the_user_wrote_it(self):
        self.assertEqual(places.expand(['berlin'], FIXTURE), ['berlin', places.pattern(['Berlin'])])   # only its own name, which it already matches

    def test_the_loader_applies_it_with_the_swiss_table_first(self):
        config = paths.with_matching_words({'locations': {'top_tier': ['romandie'], 'country_wide': ['germany'], 'abroad': []}, 'role_keywords': ['x']})
        self.assertNotIn('germany', ' '.join(config['locations']['top_tier']).lower().replace('suisse', ''))
        self.assertIn('lausanne', config['locations']['top_tier'][0].lower())


if __name__ == '__main__':
    unittest.main()
