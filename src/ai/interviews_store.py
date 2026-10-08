"""Interview analysis, finding things in Notion: the application a job URL names, a saved transcript, linking and deleting
an Interviews row. Re-exported by src/ai/interviews.py. Tests: tests/test_interviews_saved.py, tests/test_interviews_focus.py.
"""
import os

from ..notion.ledger import plain


def application_for(tracker, job_url):
    """The Applications row for a job the owner picked; a job not tracked yet is added (an interview means
    they applied; the date is marked approximate)."""
    app = by_url(tracker, [], job_url)
    if app:
        return app
    from ..notion.ledger import add_application
    add_application(tracker, job_url.strip(), approx=True, source=os.getenv('JOB_PILOTTO_SOURCE') or 'Manual')
    app = by_url(tracker, [], job_url)
    if not app:
        raise ValueError(f'Could not add {job_url} to your Applications')
    return app


def by_url(tracker, apps, job_url):
    """The application with this Job URL: among the candidates, else any stage (the owner chose it)."""
    same = lambda row: (plain(row['properties'].get('Job URL')) or '').strip() == job_url.strip()
    found = next((row for row in apps if same(row)), None)
    if found:
        return found
    rows = tracker.query_database(tracker.database_id, {'property': 'Job URL', 'url': {'equals': job_url.strip()}})
    return rows[0] if rows else None


def saved_transcript(tracker, page_id):
    """The transcript kept in a row's "Transcript" toggle."""
    for block in tracker._children(page_id):
        body = block.get(block['type'], {})
        if block['type'] == 'heading_3' and plain({'type': 'rich_text', 'rich_text': body.get('rich_text', [])}) == 'Transcript':
            return ''.join(plain({'type': 'rich_text', 'rich_text': child.get(child['type'], {}).get('rich_text', [])})
                           for child in tracker._children(block['id']))
    raise ValueError('This interview has no transcript in Notion')


def delete(tracker, page_id):
    """Move a 🎤 Interviews row to Notion's trash (restorable there for 30 days)."""
    tracker._request('PATCH', f'pages/{page_id}', {'archived': True})


def _place(tracker, page_id, seen):
    """Location and Work mode of a linked Applications row, read once per page (the app's jobs list may not
    have it, e.g. an application made before Job Pilotto). {} when Notion can't give it."""
    if page_id not in seen:
        try:
            props = tracker._request('GET', f'pages/{page_id}')['properties']
            seen[page_id] = {'location': plain(props.get('Location')) or '', 'work_mode': plain(props.get('Work mode')) or ''}
        except Exception:  # noqa: BLE001 - a trashed or unshared page: the row still lists, without a place
            seen[page_id] = {}
    return seen[page_id]
