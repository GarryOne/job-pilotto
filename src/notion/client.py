#!/usr/bin/env python3
"""Notion "Applications — Job Tracker": the durable record of jobs applied to.

SQLite in the Actions cache can be evicted; applications cannot be re-crawled,
so they live in Notion. The canonical job URL is the key shared by both.
"""
from datetime import date
import hashlib
import json
import os
import urllib.request

from .. import paths as _paths  # noqa: F401 (import side effect: loads .env before getenv below)

NOTION_VERSION = '2022-06-28'
# The default IDs below (here and in scout.py, kit.py) are the maintainer's own Notion workspace.
# Fork this project and set the matching environment variable to point at your own instead —
# see docs/notion-schema.md for what to create and README.md's Configuration section for the
# variable names.
DEFAULT_DATABASE_ID = os.getenv('NOTION_APPLICATIONS_DB', '')
# Rows in these stages stay eligible for digests; any other stage hides the job.
VISIBLE_STAGES = {'Saved', 'Kit ready'}
# Stages set from Telegram buttons. A later real application stage is never overwritten by them.
BUTTON_STAGES = ('Applied', 'Saved', 'Dismissed')
SOFT_STAGES = {'Saved', 'Dismissed', 'Kit ready'}
# 'Kit ready' = a kit was drafted automatically; 'Saved' = the owner tapped ⭐ (starred in digests).


def together(*calls, workers=4):
    """Run independent Notion reads at the same time (each is one or a few HTTP requests): a page load then waits
    for the slowest read, not the sum. Results in order; the first error is raised, like calling them in turn.
    At most `workers` at once, within Notion's rate limit (about 3 requests a second on average)."""
    from concurrent.futures import ThreadPoolExecutor
    if len(calls) < 2:
        return [call() for call in calls]
    with ThreadPoolExecutor(max_workers=min(workers, len(calls))) as pool:
        futures = [pool.submit(call) for call in calls]
        return [future.result() for future in futures]


def job_code(url):
    """Short stable code for /apply_<code>; derived from the URL so cache loss can't remap it."""
    return hashlib.sha1(url.strip().encode()).hexdigest()[:8]


PROFILE_PAGE_ID = os.getenv('NOTION_PROFILE_PAGE_ID', '')
MATCHES_DATABASE_ID = os.getenv('NOTION_MATCHES_DB', '')


def _rich(items):
    return ''.join(item.get('plain_text', '') for item in items or [])


class Tracker:
    def __init__(self, token, database_id=DEFAULT_DATABASE_ID, opener=urllib.request.urlopen):
        self.token, self.database_id, self.opener = token, database_id, opener

    @classmethod
    def from_env(cls):
        from ..features import disabled
        token = os.getenv('NOTION_TOKEN')
        if disabled('notion'):  # JOB_PILOTTO_DISABLE=notion: run as if no token were set
            return None
        return cls(token, os.getenv('NOTION_APPLICATIONS_DB') or DEFAULT_DATABASE_ID) if token else None

    def _request(self, method, path, body=None):
        request = urllib.request.Request(
            f'https://api.notion.com/v1/{path}', method=method,
            data=json.dumps(body).encode() if body is not None else None,
            headers={'Authorization': f'Bearer {self.token}', 'Notion-Version': NOTION_VERSION,
                     'Content-Type': 'application/json'})
        with self.opener(request, timeout=20) as response:
            return json.load(response)

    def _query(self, filter_=None, database_id=None):
        body, pages = {'page_size': 100}, []
        if filter_:
            body['filter'] = filter_
        while True:
            result = self._request('POST', f'databases/{database_id or self.database_id}/query', body)
            pages.extend(result['results'])
            if not result.get('has_more'):
                return pages
            body['start_cursor'] = result['next_cursor']

    def url_stages(self):
        """Job URL -> Stage for every row of the Applications database."""
        stages = {}
        for page in self._query():
            props = page['properties']
            url = props['Job URL'].get('url')
            if url:
                stages[url.strip()] = (props['Stage'].get('select') or {}).get('name')
        return stages

    def url_rows(self):
        """Job URL -> (Stage, Next step, page URL) for every Applications row (the desktop app's Jobs list)."""
        rows = {}
        for page in self._query():
            props = page['properties']
            url = props['Job URL'].get('url')
            if url:
                step = ''.join(t.get('plain_text', '') for t in (props.get('Next step') or {}).get('rich_text', []))
                rows[url.strip()] = ((props['Stage'].get('select') or {}).get('name'), step, page.get('url') or '')
        return rows

    def notion_jobs(self):
        """Every job in Notion, merged by URL: Job Matches rows (score, reason, status) and Applications rows
        (stage, next step, the kit's page). The desktop app's Jobs list is built from this (Notion is the truth)."""
        from .dedupe import normalize_url  # one entry per job, whatever URL form each database has
        text = lambda prop: ''.join(t.get('plain_text', '') for t in (prop or {}).get('rich_text') or (prop or {}).get('title') or [])
        select = lambda prop: ((prop or {}).get('select') or {}).get('name')
        found = {}
        # Job Matches and Applications at the same time: the list waits for the slower one, not both.
        matches, applications = together(lambda: self._query(None, MATCHES_DATABASE_ID) if MATCHES_DATABASE_ID else [], self._query)
        if MATCHES_DATABASE_ID:
            for page in matches:
                props = page['properties']
                url = ((props.get('Job URL') or {}).get('url') or '').strip()
                if url and normalize_url(url) not in found:
                    found[normalize_url(url)] = {'url': url, 'title': text(props.get('Job')), 'company': text(props.get('Company')),
                                  'location': text(props.get('Location')), 'work_mode': select(props.get('Work mode')) or '',
                                  'fit': (props.get('Score') or {}).get('number'), 'reason': text(props.get('Reason')),
                                  'match_status': select(props.get('Status')),
                                  'first_seen': ((props.get('First seen') or {}).get('date') or {}).get('start') or page.get('created_time', '')}
        for page in applications:
            props = page['properties']
            url = ((props.get('Job URL') or {}).get('url') or '').strip()
            if not url:
                continue
            row = found.setdefault(normalize_url(url), {'url': url, 'title': text(props.get('Job')), 'company': text(props.get('Company')),
                                         'location': text(props.get('Location')), 'work_mode': select(props.get('Work mode')) or '',
                                         'fit': (props.get('Fit score') or {}).get('number'), 'reason': '',
                                         'match_status': None, 'first_seen': page.get('created_time', '')})
            row.update(stage=select(props.get('Stage')), next_step=text(props.get('Next step')), notion_url=page.get('url') or '',
                       rejection=select(props.get('Rejection reason')) or '', rejection_lesson=text(props.get('Rejection lesson')),
                       via=text(props.get('Via')), contact=text(props.get('Contact')), kit_inputs=text(props.get('Kit inputs')))
        return list(found.values())

    def hidden_urls(self):
        """URLs of jobs that should no longer appear in digests (applied, dismissed, rejected, ...)."""
        return {url for url, stage in self.url_stages().items() if stage not in VISIBLE_STAGES}

    def find(self, url):
        pages = self._query({'property': 'Job URL', 'url': {'equals': url}})
        return pages[0] if pages else None

    def mark_applied(self, job, today=None):
        """Create the application row, or return the existing one. Returns (page, created)."""
        page, outcome = self.mark(job, 'Applied', today)
        return page, outcome == 'created'

    def mark(self, job, stage, today=None):
        """Record a Telegram button action. Returns (page, 'created' | 'updated' | 'unchanged').

        Saved/Dismissed never replace a real application stage (Applied, Interviewing, ...);
        Applied replaces Saved/Dismissed. Kit ready only lands on a new row or one with no stage:
        drafting a kit never overrides the owner's ⭐ or any later stage."""
        existing = self.find(job['url'])
        if existing:
            current = (existing['properties']['Stage'].get('select') or {}).get('name')
            if current == stage or (stage in SOFT_STAGES and current not in SOFT_STAGES and current is not None) \
                    or (stage == 'Kit ready' and current is not None):
                return existing, 'unchanged'
            props = {'Stage': {'select': {'name': stage}}}
            if stage == 'Applied':
                props['Applied on'] = {'date': {'start': (today or date.today()).isoformat()}}
            self._request('PATCH', f"pages/{existing['id']}", {'properties': props})
            return existing, 'updated'
        return self._create_row(job, stage, today), 'created'

    def _create_row(self, job, stage, today=None):
        text = lambda value: {'rich_text': [{'text': {'content': (value or '')[:2000]}}]}
        posted = (job.get('posted_at') or job.get('first_seen_at') or '')[:10]
        properties = {
            'Job': {'title': [{'text': {'content': job['title'][:2000]}}]},
            'Company': text(job.get('company')),
            'Location': text(job.get('location')),
            'Job URL': {'url': job['url']},
            'Stage': {'select': {'name': stage}},
            # Where the row came from: the desktop app sets JOB_PILOTTO_SOURCE; the bot and CI keep Telegram.
            'Source': {'select': {'name': os.getenv('JOB_PILOTTO_SOURCE') or 'Telegram'}},
        }
        ats = next((name for key, name in (('greenhouse', 'Greenhouse'), ('ashbyhq', 'Ashby'), ('lever.co', 'Lever'),
                                           ('workable', 'Workable')) if key in job['url']), None)
        if ats:
            properties['ATS'] = {'select': {'name': ats}}
        if stage == 'Applied':
            properties['Applied on'] = {'date': {'start': (today or date.today()).isoformat()}}
        if posted:
            properties['Posted'] = {'date': {'start': posted}}
        if not job.get('posted_at'):
            properties['Notes'] = text('Posted date is when Job Pilotto first saw the job.')
        return self._request('POST', 'pages', {'parent': {'database_id': self.database_id},
                                               'properties': properties})

    def _children(self, block_id):
        cursor, blocks = None, []
        while True:
            suffix = f'?page_size=100&start_cursor={cursor}' if cursor else '?page_size=100'
            result = self._request('GET', f'blocks/{block_id}/children{suffix}')
            blocks.extend(result['results'])
            if not result.get('has_more'):
                return blocks
            cursor = result['next_cursor']

    def page_text(self, page_id=PROFILE_PAGE_ID):
        """Plain-text rendering of a page: headings, paragraphs, lists and table rows. Read once per process (one
        command is one short run): a second call, e.g. the Profile for two sections, costs nothing."""
        cache = self.__dict__.setdefault('_page_texts', {})
        if page_id not in cache:
            cache[page_id] = self._page_text(page_id)
        return cache[page_id]

    def _page_text(self, page_id):
        lines = []
        blocks = self._children(page_id)
        # A table's rows are its own request: read all the page's tables at the same time.
        tables = [block for block in blocks if block['type'] == 'table']
        rows = dict(zip((t['id'] for t in tables), together(*[lambda t=t: self._children(t['id']) for t in tables])))
        for block in blocks:
            kind = block['type']
            body = block.get(kind, {})
            if kind.startswith('heading_'):
                lines.append('\n' + '#' * int(kind[-1]) + ' ' + _rich(body.get('rich_text')))
            elif kind in ('paragraph', 'quote', 'callout'):
                lines.append(_rich(body.get('rich_text')))
            elif kind in ('bulleted_list_item', 'numbered_list_item', 'to_do'):
                lines.append('- ' + _rich(body.get('rich_text')))
            elif kind == 'table':
                for row in rows[block['id']]:
                    lines.append(' | '.join(_rich(cell) for cell in row['table_row']['cells']))
        return '\n'.join(line for line in lines if line.strip()).strip()

    def upsert_match(self, properties, page_id=None, database_id=MATCHES_DATABASE_ID):
        """Create or update one Job Matches row; returns its page id."""
        if page_id:
            self._request('PATCH', f'pages/{page_id}', {'properties': properties})
            return page_id
        page = self._request('POST', 'pages', {'parent': {'database_id': database_id}, 'properties': properties})
        return page['id']

    def query_database(self, database_id, filter_=None):
        return self._query(filter_, database_id)

    def create_page(self, database_id, properties):
        return self._request('POST', 'pages', {'parent': {'database_id': database_id}, 'properties': properties})

    def trash_page(self, page_id):
        """Move a page to Notion's trash (restorable there for 30 days)."""
        return self._request('PATCH', f'pages/{page_id}', {'archived': True})

    def update_page(self, page_id, properties):
        return self._request('PATCH', f'pages/{page_id}', {'properties': properties})

    def append_blocks(self, page_id, blocks):
        return self._request('PATCH', f'blocks/{page_id}/children', {'children': blocks})

    def upload_file(self, name, data, content_type):
        """Upload bytes to Notion (≤ 5 MB on the free plan); returns the file upload id, for a file/image block."""
        created = self._request('POST', 'file_uploads', {'filename': name, 'content_type': content_type})
        boundary = f'jobpilotto{os.urandom(8).hex()}'
        body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\n'
                f'Content-Type: {content_type}\r\n\r\n').encode() + data + f'\r\n--{boundary}--\r\n'.encode()
        request = urllib.request.Request(
            f"https://api.notion.com/v1/file_uploads/{created['id']}/send", method='POST', data=body,
            headers={'Authorization': f'Bearer {self.token}', 'Notion-Version': NOTION_VERSION,
                     'Content-Type': f'multipart/form-data; boundary={boundary}'})
        with self.opener(request, timeout=60) as response:
            sent = json.load(response)
        if sent.get('status') != 'uploaded':
            raise RuntimeError(sent.get('message') or 'Notion upload failed')
        return created['id']

    def replace_section(self, page_id, heading_text, block):
        """Replace the top-level block whose text starts with heading_text (or append one) on a page."""
        for child in self._children(page_id):
            if _rich(child.get(child['type'], {}).get('rich_text')).startswith(heading_text):
                self._request('DELETE', f"blocks/{child['id']}")
        self._request('PATCH', f'blocks/{page_id}/children', {'children': [block]})

    def replace_after_heading(self, page_id, heading_text, blocks):
        """Replace what sits between the heading starting with heading_text and the next heading
        (or database view) with blocks, keeping the section's place on the page. Appends the
        heading and blocks when the page has no such heading."""
        children, heading = self._children(page_id), None
        for child in children:
            if heading is None:
                if (child['type'].startswith('heading_')
                        and _rich(child[child['type']].get('rich_text')).startswith(heading_text)):
                    heading = child
            elif child['type'].startswith('heading_') or child['type'] in ('child_database', 'link_to_page'):
                break
            else:
                self._request('DELETE', f"blocks/{child['id']}")
        if heading is None:
            title = {'object': 'block', 'type': 'heading_2',
                     'heading_2': {'rich_text': [{'type': 'text', 'text': {'content': heading_text}}]}}
            self._request('PATCH', f'blocks/{page_id}/children', {'children': [title] + blocks})
        else:
            self._request('PATCH', f'blocks/{page_id}/children', {'children': blocks, 'after': heading['id']})

    def read_kit(self, page_id, heading_text):
        """The application kit dict nested as a JSON code block inside the toggle heading

        written by replace_section(...KIT_HEADING...), or None if the page has no such section."""
        for child in self._children(page_id):
            if _rich(child.get(child['type'], {}).get('rich_text')).startswith(heading_text):
                for grandchild in self._children(child['id']):
                    if grandchild['type'] == 'code':
                        try:
                            return json.loads(_rich(grandchild['code'].get('rich_text')))
                        except json.JSONDecodeError:
                            return None
        return None

