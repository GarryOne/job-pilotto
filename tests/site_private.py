"""Marks a test that reads files of the website, which lives in the private repo job-pilotto-site: it is skipped here and runs there, where site/ is laid over this repo."""
import unittest
from pathlib import Path

SITE = Path(__file__).resolve().parents[1] / 'site'
needs_site = unittest.skipUnless(SITE.exists(), 'site/ is in the private repo job-pilotto-site: this guard runs in its CI')
