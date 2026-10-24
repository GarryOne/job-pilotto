"""The browser page after Google's sign-in: self-contained, themed, and honest about what was allowed (src/sources/google_page.py)."""
import re
import unittest

from src.sources import google_page, google_scopes as scopes

CASES = {'both': ('gmail', 'calendar'), 'gmail only': ('gmail',), 'calendar only': ('calendar',), 'none': ()}


def luminance(hex_color):
    channels = [int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    lin = [c / 12.92 if c <= .03928 else ((c + .055) / 1.055) ** 2.4 for c in channels]
    return .2126 * lin[0] + .7152 * lin[1] + .0722 * lin[2]


def contrast(a, b):
    hi, lo = sorted((luminance(a), luminance(b)), reverse=True)
    return (hi + .05) / (lo + .05)


class PageTest(unittest.TestCase):
    def test_each_case_names_what_was_allowed_and_missing(self):
        both = google_page.render(CASES['both'])
        self.assertIn('Gmail ✓', both)
        self.assertIn('Calendar ✓', both)
        gmail = google_page.render(CASES['gmail only'])
        self.assertIn('Calendar not allowed', gmail)
        self.assertIn('Reconnect', gmail)
        calendar = google_page.render(CASES['calendar only'])
        self.assertIn('Gmail not allowed', calendar)
        self.assertIn('Nothing was allowed', google_page.render(CASES['none']))
        self.assertIn('did not finish', google_page.render(None, failed='access_denied'))

    def test_theme_comes_from_the_app_with_the_browser_as_fallback(self):
        self.assertIn('data-theme="dark"', google_page.render(CASES['both'], 'dark'))
        self.assertIn('data-theme="light"', google_page.render(CASES['both'], 'light'))
        plain = google_page.render(CASES['both'], '')
        self.assertNotIn('<html lang="en" data-theme', plain)
        self.assertIn('prefers-color-scheme:dark', plain)
        self.assertNotIn('<script', google_page.render(CASES['both'], 'x"><script>'))

    def test_no_outside_loads_and_no_script(self):
        page = google_page.render(CASES['both'])
        self.assertNotRegex(page, r'(src|href)="https?://')
        self.assertNotRegex(page, r'url\(|@import|<script|<link')

    def test_text_is_readable_in_both_themes(self):
        css = google_page.CSS
        for card, ink, muted, ok, bad in (('#ffffff', '#0f1b2d', '#4c5d72', '#0e7c7b', '#b42318'), ('#121a23', '#e8ecf0', '#93a1b0', '#4fd1c5', '#ff8f84')):
            for color in (ink, muted, ok, bad):
                self.assertIn(color, css.replace('#fff;', '#ffffff;'))
                self.assertGreaterEqual(contrast(color, card), 4.5, f'{color} on {card}')


if __name__ == '__main__':
    unittest.main()
