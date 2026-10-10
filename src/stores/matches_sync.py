"""A search's scored jobs into a store's Matches, for the stores without a sync of their own (memory, sqlite): the same rows
and statuses src/notion/matches.py writes to 🎯 Job Matches, as store records (base.MATCH_FIELDS).

One row per job (base.url_key): the best scored copy of a job is written; a job applied to is Applied, else Open. After a full
search (not `partial`), a row the search no longer has becomes Dismissed, Applied, or Not seen when the crawl's open jobs lack
it (not proof the posting closed). Unchanged rows are not written. The scoring facts (tier, confidence, code, seniority,
languages, technologies, role family, salary, recruiter, scoring method, and the posting's workload, on-call, visa, remote scope,
contract, deadline, posted date and what the role involves) are written as the Job Matches columns hold them, so a
person on this Mac sees what a Notion user sees. Guarded by tests/store_contract.py (every store, Notion's through its own sync)
and tests/test_match_facts.py (each fact equals the column src/notion/matches.py writes).
"""
from datetime import datetime, timezone

from . import base
from ..notion.client import job_code

MODES = {'onsite': 'On-site', 'hybrid': 'Hybrid', 'remote': 'Remote'}   # as src/notion/matches.py writes Work mode
SENIORITY = {'junior': 'Junior', 'mid': 'Mid', 'senior': 'Senior', 'staff_principal': 'Staff/Principal',
             'lead_manager': 'Lead/Manager'}   # as src/notion/matches.py writes Seniority
ON_CALL = {'yes': 'Yes', 'no': 'No'}
VISA = {'offered': 'Offered', 'not_offered': 'Not offered'}
CONTRACT = {'permanent': 'Permanent', 'fixed_term': 'Fixed term', 'freelance': 'Freelance', 'internship': 'Internship'}
PARTS = ('role_fit', 'location', 'compensation', 'growth', 'risk')


def posting_facts(job):
    """What the posting says about the job (the extraction's own words, src/ai/enrich.py SCHEMA), as the Job Matches columns hold
    them; src/notion/matches.py writes the same. A job read by an older extractor lacks the newer ones: they stay empty until
    the next search re-reads it (EXTRACTOR_VERSION)."""
    ai = job.get('ai') or {}
    if not ai:
        return {}
    plain = lambda v: str((v.get('value') if isinstance(v, dict) else v) or '')   # a string in the schema; an object in some older rows
    workload = plain(ai.get('workload'))
    return {'workload': '' if workload == 'unknown' else workload[:2000],
            'on_call': ON_CALL.get(plain(ai.get('on_call')), ''),
            'visa': VISA.get((ai.get('visa_sponsorship') or {}).get('value'), ''),
            'remote_scope': ((ai.get('work_mode') or {}).get('remote_scope') or '')[:2000],
            'contract': CONTRACT.get(plain(ai.get('contract')), ''),
            'deadline': plain(ai.get('deadline'))[:10],
            'responsibilities': '\n'.join(str(item).strip() for item in (ai.get('responsibilities') or []) if str(item).strip())[:2000],   # one a line
            'posted': (job.get('posted_at') or plain(ai.get('posted')))[:10]}


def facts(job):
    """The scoring facts of one scored job, each as its Job Matches column holds it (src/notion/matches.py properties)."""
    fit, ai = job['fit'], job.get('ai') or {}
    found = {'tier': fit.get('tier') or '', 'confidence': fit.get('confidence') or '', 'code': job_code(job['url']),
             'scored': datetime.now(timezone.utc).date().isoformat(), 'scoring_method': fit.get('method') or 'Current'}
    if ai:
        found['seniority'] = SENIORITY.get(ai['seniority']['value'], '')
        found['languages'] = (['English'] if ai['english_is_enough']['value'] == 'yes' else []) + [
            f"{l['language']} +" for l in ai['languages'] if l['level'] == 'nice_to_have' and l['language'] in ('German', 'French', 'Italian')]
        found['salary'] = ((ai['salary']['text'] or '') if ai['salary']['stated'] else '')[:2000]   # a rich_text column keeps 2000
        found['recruiter'] = ai['employer_type']['value'] == 'recruiter'
        found['technologies'] = '; '.join(ai.get('technologies') or [])[:2000]
        found['role_family'] = ai.get('role_family') or ''
        found.update(posting_facts(job))
    return found


def record(job, status):
    """The store record for one scored job (it carries 'fit', and 'ai' once read)."""
    fit, ai = job['fit'], job.get('ai') or {}
    mode = ((ai.get('work_mode') or {}).get('value')) if ai else None
    found = {'url': job['url'].strip(), 'title': job.get('title') or '', 'company': job.get('company') or '',
             'location': job.get('location') or '', 'work_mode': MODES.get(mode, ''), 'fit': fit['score'],
             'reason': fit.get('reason') or '', 'status': status,
             'fit_detail': {'strengths': '; '.join(fit.get('strengths', [])), 'gaps': '; '.join(fit.get('gaps', [])),
                            'parts': {part: (fit.get('components') or {}).get(part) for part in PARTS}}}
    if job.get('first_seen_at'):
        found['first_seen'] = job['first_seen_at'][:10]
    return {**found, **facts(job)}


def _same(row, wanted):
    return all(row.get(field) == value for field, value in wanted.items())


def sync(matches, scored_jobs, applied_urls=frozenset(), open_urls=None, dismissed_urls=frozenset(), partial=False):
    """Write changed rows into `matches` (a store's Matches); returns the same summary line as the Notion sync."""
    best = {}
    for job in scored_jobs:
        key = base.url_key(job['url'])
        if key not in best or job['fit']['score'] > best[key]['fit']['score']:
            best[key] = job
    applied, dismissed = {base.url_key(u) for u in applied_urls}, {base.url_key(u) for u in dismissed_urls}
    rows = {base.url_key(row['url']): row for row in matches.list()}
    created = updated = 0
    for key, job in best.items():
        wanted = record(job, 'Applied' if key in applied else 'Open')
        row = rows.get(key)
        if row and _same(row, {k: v for k, v in wanted.items() if k not in ('url', 'first_seen', 'scored')}):
            continue
        matches.upsert(wanted if not row else {k: v for k, v in wanted.items() if k != 'first_seen'})
        created, updated = (created + 1, updated) if not row else (created, updated + 1)
    if partial:
        return f'Job Matches: {created} created, {updated} updated'
    open_keys = None if open_urls is None else {base.url_key(u) for u in open_urls}
    for key, row in rows.items():
        if key in best:
            continue
        status = ('Dismissed' if key in dismissed else 'Applied' if key in applied
                  else 'Not seen' if open_keys is None or key not in open_keys else None)
        if status and row['status'] != status:
            matches.set_status(row['url'], status)
            updated += 1
    return f'Job Matches: {created} created, {updated} updated'
