"""One job link, put through the same path as a job a search found.

The posting is read, stored, given stage-1 facts and a stage-2 fit score, then written to Job Matches as
Open. It is not an application: nothing is marked Applied and Gmail is not checked. A page that cannot be
read (a sign-in page instead of the posting, a refusal, or no posting text) is refused, saying what to do instead. The caller shows that.
"""
from datetime import datetime, timezone

from . import features, store
from .ai import cost, enrich, score
from .notion import ledger
from .paths import local_profile

SOURCE = 'Imported link'
NOTE = 'imported'  # the Jobs list keeps a job you asked for even when a crawl would have filtered it out
MIN_DESCRIPTION = 80


def _tracked(stores, url):
    """The answer for a link already among your applications, or None (row: its record; the run links to a new match only)."""
    existing = stores.applications.get(url)
    if not existing:
        return None
    title = existing['title'] or url
    return {'ok': True, 'line': f'Already in your applications ({existing["stage"] or "tracked"}): {title}', 'subject': title,
            'row': existing, 'created': False}


def run(db, url, *, stores, read_profile=None, client=None, stats=None, now=None):
    """Returns {ok, line, subject, row, created}; row: the match it wrote, as a record (the run links to it). Raises ValueError when
    the link cannot be taken on. The active store's data on every store; read_profile: what reads the Profile for scoring, the
    search's own (store_access.profile_source: Notion's page text there), else this Mac's profile or the store's Profile text."""
    url = (url or '').strip()
    if not url.startswith(('http://', 'https://')):
        raise ValueError('Paste the job link (it starts with https://).')
    existing = _tracked(stores, url)
    if existing:
        return existing
    if not (features.enabled('enrich') and features.enabled('score')):
        raise ValueError('Scoring needs an AI key. Add it in Settings, then add this job again.')
    pasted = url
    meta = ledger.page_meta(pasted)
    from . import ledger_store
    meta['company'] = ledger_store.company_for(stores, pasted, meta)
    # The board's own link when it has one, so this is the same row a Jobs check would store.
    url = (meta.get('url') or pasted).strip()
    if url != pasted:
        existing = _tracked(stores, url)
        if existing:
            return existing
    description = (meta.get('description') or '').strip()
    if len(description) < MIN_DESCRIPTION:
        if ledger.walled(pasted):
            raise ValueError('This site showed a sign-in page instead of the posting. Paste the job\'s text, or open the posting in Chrome '
                             'and use the Job Pilotto extension\'s "Read the jobs on this page".')
        raise ValueError('This page could not be read: it has no posting text.')
    now = now or datetime.now(timezone.utc)
    item = {'url': url, 'title': meta.get('title') or 'Role', 'company': meta.get('company') or '',
            'location': meta.get('location') or '', 'description': description,
            'date_posted': meta.get('date_posted'), 'notes': NOTE}
    job_id, _status = store.upsert_job(db, item, SOURCE, source_url=url, source_kind='job board', now=now)
    db.commit()
    seen = db.execute('SELECT first_seen_at FROM jobs WHERE id=?', (job_id,)).fetchone()
    item = dict(item, id=job_id, first_seen_at=(seen['first_seen_at'] if seen else now.isoformat(timespec='seconds')))
    fits = score.load(db)
    facts = enrich.load(db).get(job_id)
    profile = None
    if job_id not in fits:
        profile = score.scoring_profile((read_profile or (lambda: local_profile() or stores.texts.plain('profile')))() or '')
        if not (profile or '').strip():
            raise ValueError('Add your profile first. The fit score is read against it.')
    if client is None and (job_id not in fits or not facts):
        from .ai import engine
        client = engine.client(action='import')
    db.executescript(enrich.ENRICHMENT_TABLE)
    db.executescript(score.SCORES_TABLE)
    if not facts:
        facts, usage = enrich.extract(client, enrich.DEFAULT_MODEL, item)
        enrich.save(db, item, enrich.DEFAULT_MODEL, facts)
        if stats is not None:
            cost.add(stats.setdefault('enrich', {}), enrich.DEFAULT_MODEL, usage)
    item['ai'] = facts
    if job_id in fits:
        fit = fits[job_id]
    else:
        fit, usage = score.score_one(client, score.DEFAULT_MODEL, item, profile)
        score.save(db, item, score.DEFAULT_MODEL, fit, profile)
        if stats is not None:
            cost.add(stats.setdefault('score', {}), score.DEFAULT_MODEL, usage)
    item['fit'] = fit
    title, company = item['title'], item.get('company') or ''
    line = f"Added · {title} — {company} · fit {fit['score']}/100, tier {fit['tier']}"
    # The same Open match a search writes, by the search's own sync (Notion: every scoring column, its page cache in db).
    created = stores.matches.get(url) is None
    stores.matches.sync(db, [item], partial=True)
    found = stores.matches.get(url) or {}
    row = {'id': found.get('id'), 'title': title, 'url': url, 'company': company} if found.get('id') else None
    return {'ok': True, 'line': line, 'subject': ' — '.join(part for part in (company, title) if part),
            'row': row, 'created': created}
