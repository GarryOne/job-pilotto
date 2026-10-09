"""A job's sections as the store hands them to the job panel (applications.sections), made by the engine's own writers with
fictional data and turned into Markdown by the Notion adapter's one codec (src/stores/notion_blocks.to_markdown), the shapes the
real pages have (kit with a form read, rejection review with its to-dos and footer, the record with an edited answer, the prep kit's
sections, a recruiter message with its Full message toggle, a logged entry). Printed as JSON {section name: markdown}.
desktop/test/job-page-real.test.js feeds them to renderer/job-page-view.js, so a writer's format change fails a test."""
import json
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from src.ai import inbox_notion, kit, opportunity, prep, rejection
from src.notion import ledger_record
from src.stores import base, memory
from src.stores.notion_blocks import to_markdown

out = {}
job = {'title': 'Senior Site Reliability Engineer', 'company': 'Example Cloud AG', 'url': 'https://jobs.example.com/1'}
drafted = {'eligible': True, 'eligibility_note': '', 'check_before_sending': ['The form asks for a start date.'],
           'highlights': ['Ran on-call for 40 services'], 'cover_letter': 'Dear team,\n\nI run reliability today.',
           'answers': [{'question': 'Notice period', 'answer': '3 months', 'needs_review': False, 'field': 'q1'},
                       {'question': 'Salary expectation', 'answer': '140,000', 'needs_review': True, 'field': 'q2'}]}
out[kit.KIT_HEADING] = to_markdown(kit.notion_blocks(job, drafted, [{'label': 'Notice period'}], 'claude-sonnet-5-5')['heading_2']['children'])

out[rejection.HEADING] = to_markdown(rejection.blocks({
    'verdict': 'Hard skills', 'confidence': 'medium', 'stage_reached': 'CV screen (no call)', 'summary': 'They asked for Go.',
    'evidence': ['The posting lists Go first', 'Your CV names Python only'], 'improve': ['Add the Go service you ran', 'Lead with SLOs']},
    'claude-sonnet-5-5'))

record = {'recorded_at': '2026-10-01', 'answers_captured': 'Form', 'job': {'title': job['title'], 'company': job['company'], 'description': 'Run the platform.'},
          'answers': [{'question': 'Notice period', 'answer': '2 months', 'draft': '3 months'}, {'question': 'City', 'answer': 'Zurich', 'draft': 'Zurich'}],
          'cover_letter': 'Dear team,\n\nI run reliability today.'}
out[ledger_record.RECORD_HEADING] = to_markdown(ledger_record.record_blocks(record)['heading_2']['children'])

out[prep.HEADING] = to_markdown(prep.blocks({
    'interview_type': 'technical', 'assess': ['Incident handling'], 'questions': [{'question': 'Tell us about an outage', 'answer_with': 'The DNS story'}],
    'stories': ['The DNS outage'], 'gaps': ['No Go: say what you would do'], 'ask_them': ['Who is on call?'], 'unknowns': ['Team size'],
    'plan': ['30 min: the DNS story', '20 min: Go basics']}, datetime(2026, 10, 10), 0.04))

out[opportunity.HEADING] = to_markdown(opportunity.message_blocks(
    'Hi Alex, a role at Example Cloud.\n\nCould we talk on Tuesday?\n\nJoin: https://meet.example.com/abc\n\nUnsubscribe here'))


# A logged entry as every store hands it back (base.LOGGED: '### 📥 <day> · <summary>' and the message), written by the log's own
# _keep through a store (on Notion the same entry is the page's fold, read back in this shape: src/stores/notion.py sections()).
stores = memory.open_store()
app = stores.applications.create({'url': job['url'], 'title': job['title'], 'company': job['company']}, 'Applied')
inbox_notion._keep(stores, app, 'Hi Alex,\n\nCould we talk on Tuesday at 10:00?', None, 'Recruiter asked for a call', '2026-10-03T09:00:00Z')
out[base.LOGGED] = stores.applications.section(app['id'], base.LOGGED)
print(json.dumps(out, ensure_ascii=False, indent=1))
