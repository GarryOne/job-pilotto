#!/usr/bin/env python3
"""Jobs you add yourself get AI stage 1 facts and the stage 2 fit score, on their Applications row (no Job Matches row).

A job applied to elsewhere (/add, the app's "Applied elsewhere"), a recruiter's pitch, or a job logged from a
message or screenshot never went through the crawl, so it had no seniority, work mode, technologies, languages,
salary facts or fit score. Here it's written to the job cache like a found job (source "Added by you"), then:

1. stage 1 (src/ai/enrich.py, Haiku 4.5): facts from its description (or the recruiter's message);
2. stage 2 (src/ai/score.py, Sonnet 5): fit score, tier, reason, strengths, gaps against your Profile;
3. on its Applications row the columns a found job's application gets (Fit score, Tier, Seniority, Work mode,
   Recruiter, Salary if empty).

No Job Matches row (owner's decision, 30 Sep 2026): Job Matches is what a search found and scored; every job you pursue,
found or added, has one Applications row. The Jobs list shows an added job from that row (Tracker.notion_jobs), and a
search never mirrors it into Job Matches (daily.py leaves source "Added by you" out of matches.sync).

Only when the AI stages are on (their models set, as the app does with an Anthropic key); about USD 0.01–0.02
per job. A job the crawl already scored is left as it is.
"""
from datetime import datetime, timezone

from .. import features, store
from ..notion import matches
from ..notion.ledger import SELECTS, plain
from ..paths import local_profile
from . import cost, enrich, score

SOURCE = 'Added by you'
MIN_DESCRIPTION = 80  # shorter than this, there's nothing for the AI stages to read


def description_of(item, text=''):
    """What the AI stages read for a job with no posting: the message itself, else what was read from it."""
    if text and len(text.strip()) >= MIN_DESCRIPTION:
        return text.strip()
    parts = [('Role', item.get('title') or item.get('role')), ('Company', item.get('company')),
             ('Employer (not named)', item.get('client')), ('Location', item.get('location')),
             ('Work mode', item.get('work_mode')), ('Salary', item.get('salary')), ('Contract', item.get('contract')),
             ('Details', item.get('summary'))]
    return '\n'.join(f'{name}: {value}' for name, value in parts if value)


def process(db, tracker, url, job, *, row=None, client=None, stats=None, now=None):
    """Stage 1 + stage 2 for one job you added. job: title, company, location, description (optional: work_mode,
    date_posted). row: its Applications page, whose fit columns are filled. With no row yet (/add scores the job before
    its row exists), the columns are left in job['application_columns'] for ledger.add_application to write.
    Returns a short line ("fit 82/100, tier A"), or None when skipped (AI off, no text, already scored)."""
    if not (features.enabled('enrich') and features.enabled('score')):
        return None
    description = (job.get('description') or '').strip()
    if len(description) < MIN_DESCRIPTION or not url:
        return None
    now = now or datetime.now(timezone.utc)
    item = {'url': url, 'title': job.get('title') or 'Role', 'company': job.get('company') or '',
            'location': job.get('location') or '', 'work_mode': job.get('work_mode') or '',
            'description': description, 'date_posted': job.get('date_posted')}
    job_id, status = store.upsert_job(db, item, SOURCE, source_kind='you')
    db.commit()
    if status == 'seen' and job_id in score.load(db):
        return None  # found (and scored) by a search already
    if client is None:
        import anthropic
        client = anthropic.Anthropic()
    item = dict(item, id=job_id, first_seen_at=now.isoformat(timespec='seconds'))
    db.executescript(enrich.ENRICHMENT_TABLE)  # a fresh job cache has no AI tables yet
    db.executescript(score.SCORES_TABLE)
    facts, usage = enrich.extract(client, enrich.DEFAULT_MODEL, item)
    enrich.save(db, item, enrich.DEFAULT_MODEL, facts)
    cost.add(stats.setdefault('enrich', {}) if stats is not None else None, enrich.DEFAULT_MODEL, usage)
    item['ai'] = facts
    profile = score.scoring_profile(local_profile() or tracker.page_text())  # contact/links edits don't re-score
    fit, usage = score.score_one(client, score.DEFAULT_MODEL, item, profile)
    score.save(db, item, score.DEFAULT_MODEL, fit, profile)
    cost.add(stats.setdefault('score', {}) if stats is not None else None, score.DEFAULT_MODEL, usage)
    props = matches.properties(dict(item, fit=fit), 'Applied')  # the same values a found job's match carries
    if row is not None:
        _fill_application(tracker, row, props)
    else:
        job['application_columns'] = application_columns(props)
    return f"fit {fit['score']}/100, tier {fit['tier']}"


def application_columns(props, have=None):
    """The Applications columns a found job's application gets from its match; what you set (have) stays."""
    have = have or {}
    changes = {'Fit score': {'number': props['Score']['number']}}
    for name in SELECTS:
        value = (props.get(name) or {}).get('select')
        if value and value['name'] in SELECTS[name] and not plain(have.get(name)):
            changes[name] = {'select': value}
    if (props.get('Recruiter') or {}).get('checkbox') and not plain(have.get('Recruiter')):
        changes['Recruiter'] = {'checkbox': True}
    if (props.get('Salary') or {}).get('rich_text', [{}])[0].get('text', {}).get('content') and not plain(have.get('Salary')):
        changes['Salary'] = props['Salary']
    return changes


def _fill_application(tracker, row, props):
    tracker.update_page(row['id'], application_columns(props, row.get('properties')))


def hook(tracker, db_path, stats=None):
    """on_new(url, job, row) for the places that add jobs (logged messages, recruiter leads, Gmail): runs process()
    on the job cache at db_path; a failure is printed, never raised (the job is tracked either way)."""
    def on_new(url, job, row=None):
        try:
            with store.connect(db_path) as db:
                return process(db, tracker, url, job, row=row, stats=stats)
        except Exception as error:  # noqa: BLE001
            print(f'Warning: AI stages skipped for {url}: {type(error).__name__}: {error}')
            return None
    return on_new
