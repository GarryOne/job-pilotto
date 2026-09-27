"""Notion "⏰ Cronjob Runs": one row per scheduled pipeline run, with its cost and a mini-report.

`daily.main()` fills a run dict as it goes (crawl counts, per-stage AI stats from enrich/score/kit,
Job Matches sync, Telegram outcome, warnings) and hands it to `log_run` at the end. The report is
written by code from those numbers, so it costs nothing; a Notion failure never fails the run.
"""
from datetime import datetime, timezone
import os

CRON_RUNS_DATABASE_ID = os.getenv('NOTION_CRON_RUNS_DB', '98543553a1024a61bd784ada69b2a45d')
STAGES = (('enrich', 'Cost enrich (USD)', 'Enriched'), ('score', 'Cost score (USD)', 'Scored'),
          ('kits', 'Cost kits (USD)', 'Kits'), ('insight', 'Cost insight (USD)', 'Insights'),
          ('interview', 'Cost interview (USD)', 'Interviews'), ('mail', 'Cost mail (USD)', 'Emails'))


def new_run(mode):
    """The run dict an AI job fills for its ⏰ Cronjob Runs row; trigger and link come from GitHub Actions.
    Every AI job logs one (crawls, kits, insights, interviews, mail), so the rows add up to the month's spend."""
    event = os.getenv('GITHUB_EVENT_NAME', '')
    run = {'mode': mode, 'started_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
           'trigger': {'schedule': 'Schedule', '': 'Local'}.get(event, 'Manual'), 'warnings': []}
    if os.getenv('GITHUB_RUN_ID'):
        run['run_url'] = (f"{os.getenv('GITHUB_SERVER_URL', 'https://github.com')}/"
                          f"{os.getenv('GITHUB_REPOSITORY', '')}/actions/runs/{os.getenv('GITHUB_RUN_ID')}")
    return run


def _text(value):
    return {'rich_text': [{'text': {'content': value[:2000]}}]} if value else {'rich_text': []}


def _para(content, kind='paragraph'):
    return {'object': 'block', 'type': kind, kind: {'rich_text': [{'text': {'content': content[:2000]}}]}}


def total_usd(run):
    return sum((run.get(stage) or {}).get('usd', 0.0) for stage, _, _ in STAGES)


def total_tokens(run):
    return sum((run.get(stage) or {}).get(key, 0) for stage, _, _ in STAGES
               for key in ('tokens_in', 'tokens_out', 'cache_read'))


def status(run):
    if run.get('warnings') or run.get('feed_errors'):
        return 'Warnings'
    return 'OK' if run.get('new') or run.get('changed') else 'Quiet'


def report_lines(run):
    """The mini-report: a headline, then what stood out, most useful first."""
    new, changed = run.get('new', 0), run.get('changed', 0)
    feeds, errors = run.get('feeds', 0), run.get('feed_errors', 0)
    cost = total_usd(run)
    lines = [f'{new} new and {changed} changed job(s) from {feeds} feed(s); AI cost ${cost:.3f}.'
             if new or changed else f'Quiet run: nothing new from {feeds} feed(s); AI cost ${cost:.3f}.']
    for title, company, score in run.get('top_new', [])[:3]:
        lines.append(f'Top new match: {title} at {company} (score {score}).')
    kits = run.get('kits') or {}
    if kits.get('done'):
        lines.append(f"Drafted {kits['done']} application kit(s): {', '.join(run.get('kit_titles', [])[:5])}.")
    for stage, _, label in STAGES:
        info = run.get(stage) or {}
        if info.get('failed'):
            lines.append(f"{label}: {info['failed']} of {info.get('pending', '?')} call(s) failed.")
        if info.get('pending') and info.get('done', 0) < info['pending'] and not info.get('failed'):
            lines.append(f"{label}: stopped at {info.get('done', 0)} of {info['pending']} (API unavailable).")
    scored = (run.get('score') or {}).get('done', 0)
    if scored:
        lines.append(f"Scoring cost ${(run['score'].get('usd', 0) / scored):.4f} per job.")
    if errors:
        failing = ', '.join(run.get('failing_feeds', [])[:6])
        lines.append(f'{errors} feed(s) failed: {failing}.')
    if run.get('closed_stale'):
        lines.append(f"Closed {run['closed_stale']} job(s) not seen for a week.")
    lines += [f'Warning: {w}' for w in run.get('warnings', [])]
    return lines


def run_page(run):
    """(properties, children) for one Cronjob Runs row."""
    lines = report_lines(run)
    properties = {
        'Run': {'title': [{'text': {'content': f"{run['started_at'][:16].replace('T', ' ')} · {run['mode']}"}}]},
        'Started': {'date': {'start': run['started_at']}},
        'Duration (s)': {'number': run.get('seconds')},
        'Mode': {'select': {'name': run['mode']}},
        'Trigger': {'select': {'name': run.get('trigger', 'Local')}},
        'Status': {'select': {'name': status(run)}},
        'Feeds': {'number': run.get('feeds', 0)},
        'Feed errors': {'number': run.get('feed_errors', 0)},
        'New jobs': {'number': run.get('new', 0)},
        'Changed jobs': {'number': run.get('changed', 0)},
        'Closed stale': {'number': run.get('closed_stale', 0)},
        'AI cost (USD)': {'number': round(total_usd(run), 4)},
        'Tokens (total)': {'number': total_tokens(run)},
        'Telegram': _text(run.get('telegram', '')),
        'Summary': _text(lines[0]),
    }
    for stage, cost_name, count_name in STAGES:
        info = run.get(stage) or {}
        properties[cost_name] = {'number': round(info.get('usd', 0.0), 4)}
        properties[count_name] = {'number': info.get('done', 0)}
    if run.get('top_new'):
        properties['Top new score'] = {'number': run['top_new'][0][2]}
    if run.get('run_url'):
        properties['Run URL'] = {'url': run['run_url']}
    children = [_para('Report', 'heading_3')] + [_para(line, 'bulleted_list_item') for line in lines]
    children.append(_para('Stages', 'heading_3'))
    for stage, _, label in STAGES:
        info = run.get(stage)
        if info:
            children.append(_para(
                f"{label} with {info.get('model', '?')}: {info.get('done', 0)} of {info.get('pending', 0)}; "
                f"tokens in {info.get('tokens_in', 0)} (+{info.get('cache_read', 0)} cached), "
                f"out {info.get('tokens_out', 0)}; ${info.get('usd', 0.0):.4f}", 'bulleted_list_item'))
    if run.get('matches'):
        children.append(_para(f"Job Matches: {run['matches']}", 'bulleted_list_item'))
    return properties, children[:95]


def log_run(tracker, run):
    """Create the Cronjob Runs row; returns its URL, or None when Notion refuses (never raises)."""
    try:
        properties, children = run_page(run)
        page = tracker._request('POST', 'pages', {'parent': {'database_id': CRON_RUNS_DATABASE_ID},
                                                  'properties': properties, 'children': children})
        return page.get('url')
    except Exception as error:
        print(f'Warning: cronjob run not logged to Notion: {type(error).__name__}: {error}')
        return None
