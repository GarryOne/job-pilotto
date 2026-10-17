"""A search list entry stored as "tax" (the settings page's whole-word form, with its quotes) matches the word, not the quotes.

17 Oct 2026: the owner's lists held "zug", "tax", "legal", "sales", "sre" with their quotes; the crawl compiled them literally, so Zug jobs never
matched a place and "Tax" titles were never skipped. Every reader of a list (keyword_regex, place_regex, tune) and the old page format's parser
read "x" as whole-word x.
"""
import unittest

from src.paths import keyword_regex, place_regex
from src.notion.search_settings import fragment_v1, fragment_of, readable, terms
from src.places import words_of
from src import tune


class QuotedPatternsTest(unittest.TestCase):
    def test_every_list_reader_matches_the_word_not_the_quotes(self):
        titles = keyword_regex(['"tax"', '"sre"', 'counsel'])
        self.assertTrue(titles.search('Senior Tax Manager'))
        self.assertTrue(titles.search('SRE (m/f)'))
        self.assertFalse(titles.search('Taxonomy Engineer'), 'whole word only')
        self.assertTrue(place_regex(['"zug"', '\\bz[uü]rich\\b']).search('Zug, Switzerland'))
        self.assertFalse(place_regex(['"zug"']).search('Zugerland'))
        self.assertTrue(tune._matches('"tax"', 'Tax Advisor'))

    def test_a_plain_or_regex_entry_is_unchanged(self):
        self.assertTrue(keyword_regex(['site reliability']).search('Site Reliability Engineer'))
        self.assertTrue(keyword_regex(['\\bsre\\b']).search('an sre role'))
        self.assertTrue(keyword_regex(['"']).pattern == '"', 'a lone quote is not a quoted word')

    def test_the_old_page_format_reads_a_quoted_entry_as_whole_word_too(self):
        self.assertEqual(fragment_v1('"zug"'), fragment_of('"zug"'))
        self.assertEqual(fragment_v1('"zug"'), '\\bzug\\b')

    def test_the_page_and_the_plain_words_read_a_quoted_entry_as_the_word(self):
        # The owner's page showed /"tax"/, /"zug"/, /"sre"/ (9 entries) and the text-search sites never got those words.
        for stored in ['"tax"', '"zug"', '"sre"', '"dübendorf"']:
            self.assertEqual(readable(stored), stored, 'shown in the page\'s whole-word form, not as /"x"/')
            self.assertEqual(fragment_of(readable(stored)), fragment_of(stored), 'read back: the same whole-word match as the page entry')
        self.assertEqual(terms(['"zug"', 'basel', '"sre"']), ['zug', 'basel', 'sre'])
        self.assertEqual(words_of({'locations': {'top_tier': ['"zug"'], 'country_wide': ['"winterthur"']}}), ['zug', 'winterthur'])


if __name__ == '__main__':
    unittest.main()
