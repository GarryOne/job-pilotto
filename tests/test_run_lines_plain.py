"""The lines the engine prints for a run card are plain words: a place word counted like a noun, no regex in the job boards line (18 Oct 2026: "Broken writing")."""
import contextlib
import io
import re
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src import places


class PlacesLine(unittest.TestCase):
    def said(self, words):
        search = {'locations': {'top_tier': words}}
        out = io.StringIO()
        with tempfile.TemporaryDirectory() as folder, contextlib.redirect_stdout(out), mock.patch.object(places, 'ask', lambda client, asked: {w: {} for w in asked}):
            places.refresh(search, client=object(), file=Path(folder) / 'places.json')
        return out.getvalue().strip()

    def test_one_place_word_and_several_are_counted_like_nouns(self):
        self.assertEqual(self.said(['zug']), 'Places: worked out 1 place word with AI: zug')
        self.assertEqual(self.said(['zug', 'bern']), 'Places: worked out 2 place words with AI: zug, bern')


class BoardsLine(unittest.TestCase):
    def test_the_job_boards_line_names_boards_not_the_regex_that_made_the_search_swiss(self):
        source = (Path(__file__).resolve().parent.parent / 'src' / 'sources' / 'boards.py').read_text()
        line = next(text for text in source.splitlines() if "print('Job boards: '+" in text)
        self.assertNotIn('swiss_word', line)
        self.assertIsNone(re.search(r'place word', line))


if __name__ == '__main__':
    unittest.main()
