"""Interview analysis, the job an interview belongs to, on the store: finding it (by id, by URL), adding a job an interview
names that isn't tracked yet, and adding its 📈 event. Application records (src/stores/base.py), never Notion pages.
Re-exported by src/ai/interviews.py. Tests: tests/test_interviews_store.py.

Events go through src/stores/rules.add_event (the ledger's rules on any store). Adding an untracked job is a bridge until
rules.add_application lands: with Notion today's src/notion/ledger.py through the tracker; elsewhere a plain store write.
"""
import os
from datetime import datetime, timezone

from ..notion import titles
from ..stores import rules
from ..stores.base import url_key


def key(record_id):
    return (record_id or '').replace('-', '')


def role(app):
    """The application's role, its job title without the "· via …" suffix."""
    return titles.role_of((app or {}).get('title') or '', (app or {}).get('company') or '', (app or {}).get('via') or '')


def who(app):
    return (app or {}).get('company') or (app or {}).get('via') or ''


def app_by_id(stores, app_id, apps=None):
    """The application with this id (Notion ids compare with or without dashes), or None."""
    return next((r for r in (apps if apps is not None else stores.applications.list()) if key(r['id']) == key(app_id)), None)


def by_url(stores, apps, job_url):
    """The application with this Job URL: among the candidates, else any stage (the owner chose it)."""
    wanted = url_key(job_url)
    return next((r for r in apps if url_key(r.get('url')) == wanted), None) or stores.applications.get(job_url.strip())


def application_for(stores, job_url, tracker=None):
    """The application for a job the owner picked; a job not tracked yet is added (an interview means they applied;
    the date is marked approximate)."""
    found = by_url(stores, [], job_url)
    if found:
        return found
    source = os.getenv('JOB_PILOTTO_SOURCE') or 'Manual'
    # BRIDGE(focus): remove when rules.add_application lands
    if stores.name == 'notion' and tracker is not None:
        from ..notion.ledger import add_application
        add_application(tracker, job_url.strip(), approx=True, source=source)
    else:
        today = datetime.now(timezone.utc).date().isoformat()
        app, _ = stores.applications.set_stage({'url': job_url.strip(), 'date_approximate': True, 'source': source,
                                                'applied_on': today}, 'Applied', today=today)
        rules.add_event(stores, app, 'Applied', source, at=today, note='Added with an interview')
    found = by_url(stores, [], job_url)
    if not found:
        raise ValueError(f'Could not add {job_url} to your Applications')
    return found
