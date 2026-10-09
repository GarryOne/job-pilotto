"""The desktop Jobs list from a store that is not Notion: Tracker.notion_jobs()'s list, in exactly its shape, built from
stores.matches (what a search found and scored) and stores.applications (every job pursued), merged by url_key.

The app's Jobs list, counters and board (desktop/renderer) read these keys; on Notion the list stays Tracker.notion_jobs()
(src/desktop.py). Guarded by tests/test_desktop_store_jobs.py.
"""
from .notion import titles
from .stores.base import url_key


def _score(value):
    """A fit as notion_jobs() gives it: a number or None (a store may keep an empty score as '')."""
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def store_jobs(stores):
    """[{url, title, company, …, stage, applied_on, …}] like Tracker.notion_jobs(): matches first, then each application
    adds its stage and columns (an application with no match brings its own title, company and fit)."""
    found = {}
    for match in stores.matches.list():
        url = (match.get('url') or '').strip()
        if url and url_key(url) not in found:
            found[url_key(url)] = {'url': url, 'title': match.get('title') or '', 'company': match.get('company') or '',
                                   'location': match.get('location') or '', 'work_mode': match.get('work_mode') or '',
                                   'fit': _score(match.get('fit')), 'reason': match.get('reason') or '',
                                   'fit_detail': match.get('fit_detail') or {'strengths': '', 'gaps': '', 'parts': {}},
                                   'match_status': match.get('status'), 'first_seen': match.get('first_seen') or ''}
    for app in stores.applications.list():
        url = (app.get('url') or '').strip()
        if not url:
            continue
        row = found.setdefault(url_key(url), {'url': url, 'title': app.get('title') or '', 'company': app.get('company') or '',
                                              'location': app.get('location') or '', 'work_mode': app.get('work_mode') or '',
                                              'fit': _score(app.get('fit')), 'reason': '', 'match_status': None,
                                              'first_seen': app.get('created_at') or ''})
        row.update(stage=app.get('stage'), next_step=app.get('next_step') or '', notion_url='',   # no page elsewhere: the app's own job page
                   rejection=app.get('rejection') or '', rejection_lesson=app.get('rejection_lesson') or '',
                   feedback_status=app.get('feedback_status') or '', employer_feedback=app.get('employer_feedback') or '',
                   page_id=app.get('id') or '', next_interview=app.get('next_interview') or '',
                   via=app.get('via') or '', contact=app.get('contact') or '', kit_inputs=app.get('kit_inputs') or '',
                   origin=app.get('origin') or '', source=app.get('source') or '', notes=(app.get('notes') or '')[:60],
                   applied_on=app.get('applied_on') or '')
        row['title'] = titles.role_of(row['title'], row['company'], row['via'])
    return list(found.values())
