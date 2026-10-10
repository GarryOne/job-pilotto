"""A posting's HTML keeps its shape as text (src/sources/posting_text.py): headings, paragraphs and list items on their own lines."""
import unittest

from src.sources import ats, feeds
from src.sources.posting_text import html_to_text

HTML = ('<h2>Responsibilities</h2><ul><li>Run on-call &amp; incidents</li><li>Build <b>automation</b></li></ul>'
        '<p><strong>Requirements:</strong></p><p>Kubernetes in production.<br>Terraform.</p><p>CHF&nbsp;130&ndash;150k</p>')


class PostingTextTests(unittest.TestCase):
    def test_headings_items_and_paragraphs_keep_their_lines(self):
        self.assertEqual(html_to_text(HTML),
                         '## Responsibilities\n- Run on-call & incidents\n- Build automation\n\n## Requirements\nKubernetes in production.\nTerraform.\n\nCHF 130–150k')

    def test_a_paragraph_of_only_bold_words_is_a_heading_but_bold_in_a_sentence_is_not(self):
        self.assertIn('## Benefits', html_to_text('<p><b>Benefits</b></p><p>Good pay</p>'))
        self.assertEqual(html_to_text('<p>We value <b>kindness</b> here</p>'), 'We value kindness here')

    def test_escaped_twice_text_without_tags_and_empties(self):
        self.assertEqual(html_to_text('&lt;p&gt;Hello&lt;/p&gt;&lt;ul&gt;&lt;li&gt;One&lt;/li&gt;&lt;/ul&gt;'), 'Hello\n\n- One')
        self.assertEqual(html_to_text('Just words,  already plain.'), 'Just words, already plain.')
        self.assertEqual(html_to_text(None), '')
        self.assertEqual(html_to_text('<ul><li></li><li>  </li></ul><p></p>'), '')

    def test_no_run_of_blank_lines_and_the_limit_holds(self):
        self.assertNotIn('\n\n\n', html_to_text('<p>a</p><p></p><p></p><br><br><p>b</p>'))
        self.assertEqual(len(html_to_text('<p>' + 'x' * 50 + '</p>', limit=10)), 10)

    def test_both_fetchers_read_it_the_same_way(self):
        self.assertEqual(ats.plain(HTML), html_to_text(HTML))
        self.assertEqual(feeds.plain_text(HTML), html_to_text(HTML))


if __name__ == '__main__':
    unittest.main()
