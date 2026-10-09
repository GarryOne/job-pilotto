"""The application stage rules, above the store interface: one copy for every store (sqlite, notion, later ones).

What `Tracker.mark`, `revert_applying` and `revert_unsubmitted` (src/notion/client.py) decided for Notion alone:
a button's soft stage (Saved, Dismissed, Kit ready) never overwrites a real one; Applying goes back to Kit ready
when a session ends unsent; a bare Applied the owner says was wrong goes back to Applying, while a stage the
employer's side produced is never undone. Callers pass `stores` (src/stores open_stores()). Guarded by
tests/test_store_rules.py on the memory store.
"""
import os

from . import base

SOFT_STAGES = {'Saved', 'Dismissed', 'Kit ready'}
# Stages with the employer's own evidence behind them (a confirmation email, an interview, an answer).
EMPLOYER_STAGES = ('Confirmation received', 'Screening', 'Interview scheduling', 'Interview scheduled',
                   'Interviewing', 'Offer', 'Rejected', 'Withdrawn', 'No response')
UPDATED = 'updated'
PAST = 'past'


def new_job(job):
    """A job's fields for a new row: where it came from (the app sets JOB_PILOTTO_SOURCE; the bot and CI keep
    Telegram) and Outbound, as every row a person goes after by themselves (src/notion/origin.py)."""
    return {'source': os.getenv('JOB_PILOTTO_SOURCE') or 'Telegram', 'origin': 'Outbound',
            **{k: v for k, v in job.items() if k in base.APPLICATION_FIELDS and v not in (None, '')}}


def mark(stores, job, stage, today=None):
    """A button's stage (Telegram, the app): (record, created | updated | unchanged).

    Saved/Dismissed never replace a real stage (Applied, Interviewing, ...); Applied replaces Saved/Dismissed.
    Kit ready only lands on a new row or one with no stage: drafting a kit never overrides a ⭐ or a later stage."""
    today = today.isoformat() if hasattr(today, 'isoformat') else today
    current = stores.applications.get(job['url'])
    if current:
        stage_now = current['stage'] or None
        if stage_now == stage or (stage in SOFT_STAGES and stage_now not in SOFT_STAGES and stage_now is not None) \
                or (stage == 'Kit ready' and stage_now is not None):
            return current, base.UNCHANGED
        row, _ = stores.applications.set_stage(job, stage, today)
        return row, UPDATED
    row, _ = stores.applications.set_stage(new_job(job), stage, today)
    return row, base.CREATED


def revert_applying(stores, url):
    """A session that ended without a submission: Applying goes back to Kit ready (the kit is still there).
    Only from Applying. Returns 'updated' | 'unchanged'."""
    current = stores.applications.get(url)
    if not current or current['stage'] != 'Applying':
        return base.UNCHANGED
    stores.applications.update(current['id'], {'stage': 'Kit ready'})
    return UPDATED


def revert_unsubmitted(stores, url):
    """The owner says an Applied was wrong (nothing was submitted): back to Applying, Applied on cleared. A stage
    the employer's side produced is left alone. Returns (outcome, record): 'updated' | 'unchanged' | 'past'."""
    current = stores.applications.get(url)
    if not current:
        return base.UNCHANGED, None
    if current['stage'] in EMPLOYER_STAGES:
        return PAST, current
    if current['stage'] != 'Applied':
        return base.UNCHANGED, current
    return UPDATED, stores.applications.update(current['id'], {'stage': 'Applying', 'applied_on': ''})
