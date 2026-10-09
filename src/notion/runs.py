"""The names a form fill's run is recorded with: its job board from the URL, its agent and its status.

The run itself is written through the store (src/ai/apply_record.py: 🤖 Agent Runs in Notion, or this Mac's store);
this file keeps only the shared names. Guarded by tests/test_apply_record.py.
"""
from ..sources import ats

ATS_NAMES = {'greenhouse': 'Greenhouse', 'ashby': 'Ashby', 'lever': 'Lever', 'workable': 'Workable'}
STATUS_NAMES = {'ready': 'Ready', 'needs_user': 'Needs input', 'failed': 'Failed'}
AGENT_NAMES = {'claude': 'Claude', 'codex': 'Codex', 'chatgpt': 'ChatGPT', 'manual': 'Manual'}


def ats_name(url):
    found = ats.detect(url)
    return ATS_NAMES.get(found[0], 'Other') if found else 'Other'
