"""How many of a persona's top 10 jobs are right for them, judged apart from the scorer: the model reads the fictional CV itself (personas.py,
not the app's drafted profile) and says, per job, whether this person would apply: their kind of role, their level, a place they can work
from (owner, 18 Oct 2026: the target is at least 7 of the top 10 right). Prints one JSON line {right, of, verdicts}.
Usage: python3 tools/persona-search/judge.py <persona out dir> <name> (the dir holds presses.jsonl; run.mjs --judge calls it).
Engine: the one the environment names (local: the Claude Code plan, $0); run.mjs never calls it on the API engine."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from personas import PERSONAS  # noqa: E402
from src.ai import engine  # noqa: E402
from src.ai.models import MAIN_MODEL  # noqa: E402

SYSTEM = ('You check a job search for one job seeker. You get their CV and up to 10 jobs the search ranked highest for them. For each job, '
          'say whether this person would really apply: a role of their kind and level, a place they can work from (their city or a short commute, '
          'or remote they can do from there). Judge each job on its own; when the title alone leaves it open, say what decides it. why: 12 words at most.')
SCHEMA = {'type': 'object', 'additionalProperties': False, 'required': ['jobs'], 'properties': {'jobs': {'type': 'array', 'items': {
    'type': 'object', 'additionalProperties': False, 'required': ['n', 'right', 'why'],
    'properties': {'n': {'type': 'integer'}, 'right': {'type': 'boolean'}, 'why': {'type': 'string'}}}}}}


def cv_text(out, name):
    """The fictional CV's own lines; the SRE control (a copied PDF) falls back to the profile the app drafted from it."""
    if name in PERSONAS:
        return '\n'.join(PERSONAS[name])
    draft = json.loads((Path(out) / 'draft.json').read_text())
    return draft.get('profile_markdown') or draft.get('summary') or ''


def judge(out, name, client=None):
    rows = [json.loads(line) for line in (Path(out) / 'presses.jsonl').read_text().splitlines() if line.strip()]
    top = (rows[-1].get('top10') if rows else None) or []
    if not top:
        return {'right': 0, 'of': 0, 'verdicts': []}
    listed = '\n'.join(f"{n}. {job['title']} | {job.get('company') or '?'} | {job.get('location') or '?'}" for n, job in enumerate(top, 1))
    client = client or engine.client(action='judge')
    response = client.messages.create(model=MAIN_MODEL, max_tokens=3000, system=[{'type': 'text', 'text': SYSTEM}],
                                      messages=[{'role': 'user', 'content': f'CV:\n{cv_text(out, name)}\n\nJobs:\n{listed}'}],
                                      output_config=engine.structured(SCHEMA, MAIN_MODEL, 'low'))
    answer = json.loads(next(block.text for block in response.content if block.type == 'text'))
    verdicts = [{**top[item['n'] - 1], 'right': bool(item['right']), 'why': item['why'][:120]}
                for item in answer['jobs'] if isinstance(item.get('n'), int) and 1 <= item['n'] <= len(top)]
    return {'right': sum(1 for item in verdicts if item['right']), 'of': len(top), 'verdicts': verdicts}


if __name__ == '__main__':
    print(json.dumps(judge(sys.argv[1], sys.argv[2]), ensure_ascii=False))
