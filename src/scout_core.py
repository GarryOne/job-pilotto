"""Shared base of the source scout (src/scout.py and its scout_*.py pieces): paths, tuning numbers, the candidate table's SQL,
the search words, the small name helpers, and the two settings the pieces share as ONE binding: `CENTRAL` (set by `scout.main` for the central
scout) and `EMPLOYERS_DB` (the Notion Employers & Sources database). Read them as `scout_core.CENTRAL` / `scout_core.EMPLOYERS_DB`.
Tests: tests/test_scout.py, tests/test_scout_notion_sync.py, tests/test_seeds_private.py, tests/test_stop_means_stop.py.
"""

import json
import os
import re
import sqlite3
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from .paths import CONFIG, load_search_config
from .sources import ats


SEEDS = CONFIG / 'scout_seeds.json'
# Notion "Employers & Sources": one row per employer or job board (formerly Source Registry + Company Research).
EMPLOYERS_DB = os.getenv('NOTION_EMPLOYERS_DB', '')
DEFAULT_BATCH = 40      # candidates probed per run (15 until 3 Oct 2026: the queue then held 400+ names and moved too slowly)
# A long queue is worked through faster and not made longer (owner, 7 Oct 2026: 609 ideas waited, the app probed 15 a run while each run added ~200):
# a run probes a sixth of the queue (40 to 100), and adds no new names while more than IDEAS_PAUSE wait.
MAX_BATCH, IDEAS_PAUSE = 100, 100


def batch_for(pending, asked=DEFAULT_BATCH):
    """How many candidates a run probes, for this many waiting: at least what was asked, more for a long queue."""
    return max(asked, min(MAX_BATCH, (pending or 0) // 6))


def pending_count(db):
    try:
        return db.execute("SELECT COUNT(*) FROM scout_candidates WHERE status = 'pending'").fetchone()[0]
    except sqlite3.OperationalError:   # before the first run made its table
        return 0
HN_THREADS = 2          # Latest monthly "Who is hiring?" threads to read.
RECHECK_DAYS = {'low': 21, 'none': 90, 'watch': 7}   # watch: a careers page with no open jobs today, looked at again weekly
# Tier 1 feeds are crawled with this many matching roles anywhere: their Zurich/London roles come and go.
TIER1_MIN_RELEVANT = 3
SMALL_GUESS = 5   # a guessed feed with fewer jobs is checked against the company's own careers page (find_feed)
# Lists of software employers only: Hacker News "Who is hiring?", hiring-without-whiteboards, SwissDevJobs, and the seed lists unless the seed file
# says "tech_only": false (absent means true: every app copied the shipped tech list at first run). A search outside IT neither harvests nor probes
# them (6 Oct 2026: a photographer's runs checked Netflix, Stripe and Databricks while the AI's Geneva retail and watchmaking ideas waited in the
# queue). Wikidata, jobs.ch employers and the AI's ideas cover every trade.
TECH_LIST_ORIGINS = ('Hacker News', 'hiring-without-whiteboards', 'SwissDevJobs')
SEED_ORIGINS = ('Tier 1 seed', 'Seed list:')

TABLES = """
CREATE TABLE IF NOT EXISTS scout_candidates (
    key TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    origin TEXT NOT NULL,
    priority INTEGER NOT NULL,
    tier TEXT NOT NULL DEFAULT 'Standard',
    ats TEXT,
    slug TEXT,
    careers TEXT,
    website TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    quality INTEGER,
    stats_json TEXT,
    added_at TEXT NOT NULL,
    checked_at TEXT,
    next_check TEXT
);
-- Which checked employers each Employers & Sources database already has a row for (sync_notion): a run without Notion, a failed
-- write or a new workspace leaves some out, and they are written later instead of staying only on this computer (6 Oct 2026).
CREATE TABLE IF NOT EXISTS notion_synced (
    db_id TEXT NOT NULL,
    key TEXT NOT NULL,
    PRIMARY KEY (db_id, key)
);
CREATE TABLE IF NOT EXISTS feed_sources (
    ats TEXT NOT NULL,
    slug TEXT NOT NULL,
    company TEXT NOT NULL,
    tier TEXT NOT NULL DEFAULT 'Standard',
    quality INTEGER,
    active INTEGER NOT NULL DEFAULT 1,
    added_at TEXT NOT NULL,
    PRIMARY KEY (ats, slug)
);
"""
_SEARCH = load_search_config()


def now():
    return datetime.now(timezone.utc)


def clean_name(name):
    """A company name as a person would write it: harvested text ('Acme|Senior SRE|Remote', 'Acme https://acme.io') is cut back."""
    name = re.split(r'\s*[|]\s*', re.sub(r'https?://\S+', ' ', name or ''), 1)[0]
    return re.sub(r'\s+', ' ', name).strip(' -–—:,;')[:60]


def key_for(name):
    return re.sub(r'[^a-z0-9]', '', re.sub(r'\b(ag|sa|gmbh|ltd|inc|llc|plc)\b', '', name.lower()))


def _get_json(url, timeout=30):
    request = urllib.request.Request(url, headers={'User-Agent': ats.USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def _get_text(url):
    request = urllib.request.Request(url, headers={'User-Agent': ats.USER_AGENT})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode('utf-8', 'replace')


# The central scout (python -m src scout --publish-index, job-pilotto-internal) keeps the full lists it publishes; an install ignores the copies
# of the lists the app shipped before 6 Oct 2026 (src/legacy_lists.py): those sources reach it through the central index now.
CENTRAL = False
