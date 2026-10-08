#!/usr/bin/env python3
"""Run the local scan, import canonical state and optionally send Telegram digest."""
import argparse
from collections import Counter
from datetime import datetime, timezone
from html import escape
import json
import os
import random
import re
import sys

from . import contribute, digest, employer_index, features, import_url, role_kinds, scout, store, telegram, tgcard
from . import doctor
from . import coverage
from .ai import added, budget, cost, enrich, inbox, insights, interview_insights, interviews, kit, provenance, score
from .notion import client as notion, cron_runs, funnel, ledger, matches
from pathlib import Path

from .paths import JOBS_DB, CONFIG, DATA, REPORTS, load_search_config, local_profile
from .sources import ats, describe, feeds, google_jobs
from .daily_args import build_parser
from .daily_modes import add_link_mode, add_message_mode, apply_mode, import_mode, insight_mode, interview_mode, kits_mode, prepare_mode
from .daily_search import search
from .daily_helpers import (  # noqa: F401 -- re-exported: other modules and tests use `daily.<name>`
    ACTIONS, KITS_DEFAULT, MODES, NO_PROFILE, STALE_DAYS, _job_arg, _url_key, apply_message, apply_switches, crawl_counts, digest_note,
    downloaded_index, find_job, for_job_matches, kits_message, left_out, log_ai_run, log_crawl, log_text, new_cron_run, no_profile, plural,
    prepare_kit, queue_mail_check, save_run, scored_companies, starter_sources, time_budget_on, to_score, top_new, tracked_job)


def main():
    parser = build_parser(__doc__)
    args = parser.parse_args()
    if args.budget:   # the app's searches stop their AI steps at this many seconds; what is left waits for the next search
        from . import time_budget
        time_budget.start(args.budget)
        print(f'Time budget: this search stops its AI steps at {args.budget // 60} min {args.budget % 60:02d} s; what is left waits for the next one', flush=True)
    if args.only_visits and args.mode != 'today':   # a full search's closers would close every job it did not read
        parser.error('--only-visits needs --mode today')
    if not 1 <= args.limit <= 50:
        parser.error('--limit must be between 1 and 50')
    apply_switches(args)
    tracker = notion.Tracker.from_env()
    # The app's check-first step (--propose) is a preview, not a run: no ⏱️ Search runs row (it once ended as
    # "Failed: ended before its report", toasting "had problems" for a good reading). Its cost is counted in the
    # confirmed step's run (--reading carries it).
    if tracker and (args.send or args.log_run) and not args.propose:
        cron_runs.auto_begin(tracker)  # the run's ⏱️ Search runs row opens when it starts
    if args.mode == 'import':
        return import_mode(args, tracker)
    if args.mode == 'apply':
        return apply_mode(args, tracker)
    if args.mode == 'prepare':
        return prepare_mode(args, tracker)
    if args.mode == 'kits':
        return kits_mode(args, tracker)
    if args.mode == 'add' and not args.job:
        return add_message_mode(args, tracker)
    if args.mode == 'add':
        return add_link_mode(args, tracker)
    if args.mode == 'interview':
        return interview_mode(args, tracker)
    if args.mode in ('insight', 'weekly'):
        return insight_mode(args, tracker)
    return search(args, tracker)


if __name__ == '__main__':
    main()
