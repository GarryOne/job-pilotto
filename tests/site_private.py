"""Marks a test that reads files of the website, which lives in the private repo job-pilotto-site: it is skipped here and runs there, where its folders (web/, admin/, api/, shared/, workers/ …) are laid over this repo."""
import unittest
from pathlib import Path

# The contract between the two repos is one way (owner, 21 Oct 2026: "stop the cross-repo reds"): the site lands first and may know MORE than public lists; it must never know LESS.
# A test that compares a list of public with the site's copy uses site_missing / assert_site_accepts: red only for what public lists and the site lacks.
SITE = Path(__file__).resolve().parents[1] / 'admin'
needs_site = unittest.skipUnless(SITE.exists(), 'the site folders (web/, admin/, api/ …) are in the private repo job-pilotto-site: this guard runs in its CI')


def site_missing(public, site):
    """What public lists that the site does not accept (order and extras on the site do not matter)."""
    known = set(site)
    return sorted((item for item in set(public) if item not in known), key=str)


def assert_site_accepts(test, public, site, what):
    """Fails only when public lists or sends something the site lacks: the site may run ahead (it lands first)."""
    gone = site_missing(public, site)
    test.assertEqual(gone, [], f'{what}: public lists these and the site (on its main) does not accept them: land the site half first (docs/rules/private-site.md)')
