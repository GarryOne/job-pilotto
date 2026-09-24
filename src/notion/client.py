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

NOTION_VERSION = '2022-06-28'
# The default IDs below (here and in scout.py, kit.py) are the maintainer's own Notion workspace.
# Fork this project and set the matching environment variable to point at your own instead —
# see docs/notion-schema.md for what to create and README.md's Configuration section for the
# variable names.
DEFAULT_DATABASE_ID = os.getenv('NOTION_APPLICATIONS_DB', 'f56b68942d3b43cbb85a7b1ebfe2df1b')
# Rows in these stages stay eligible for digests; any other stage hides the job.
VISIBLE_STAGES = {'Saved'}
# Stages set from Telegram buttons. A later real application stage is never overwritten by them.
BUTTON_STAGES = ('Applied', 'Saved', 'Dismissed')
SOFT_STAGES = {'Saved', 'Dismissed'}


def job_code(url):
    """Short stable code for /apply_<code>; derived from the URL so cache loss can't remap it."""
    return hashlib.sha1(url.strip().encode()).hexdigest()[:8]


PROFILE_PAGE_ID = os.getenv('NOTION_PROFILE_PAGE_ID', '3e562be8fd8681579078d09829921b8c')
MATCHES_DATABASE_ID = os.getenv('NOTION_MATCHES_DB', '2d8077c592fd45db8d6d5c8e2eea75cb')


def _rich(items):
    return ''.join(item.get('plain_text', '') for item in items or [])


class Tracker:
    def __init__(self, token, database_id=DEFAULT_DATABASE_ID, opener=urllib.request.urlopen):
        self.token, self.database_id, self.opener = token, database_id, opener

    @classmethod
    def from_env(cls):
        token = os.getenv('NOTION_TOKEN')
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
        Applied replaces Saved/Dismissed."""
        existing = self.find(job['url'])
        if existing:
            current = (existing['properties']['Stage'].get('select') or {}).get('name')
            if current == stage or (stage in SOFT_STAGES and current not in SOFT_STAGES and current is not None):
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
            'Source': {'select': {'name': 'Telegram'}},
        }
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
        """Plain-text rendering of a page: headings, paragraphs, lists and table rows."""
        lines = []
        for block in self._children(page_id):
            kind = block['type']
            body = block.get(kind, {})
            if kind.startswith('heading_'):
                lines.append('\n' + '#' * int(kind[-1]) + ' ' + _rich(body.get('rich_text')))
            elif kind in ('paragraph', 'quote', 'callout'):
                lines.append(_rich(body.get('rich_text')))
            elif kind in ('bulleted_list_item', 'numbered_list_item', 'to_do'):
                lines.append('- ' + _rich(body.get('rich_text')))
            elif kind == 'table':
                for row in self._children(block['id']):
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

    def update_page(self, page_id, properties):
        return self._request('PATCH', f'pages/{page_id}', {'properties': properties})

    def replace_section(self, page_id, heading_text, block):
        """Replace the top-level block whose text starts with heading_text (or append one) on a page."""
        for child in self._children(page_id):
            if _rich(child.get(child['type'], {}).get('rich_text')).startswith(heading_text):
                self._request('DELETE', f"blocks/{child['id']}")
        self._request('PATCH', f'blocks/{page_id}/children', {'children': [block]})

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

