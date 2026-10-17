"""The person's places as the fit score reads them (Locations, owner 17 Oct 2026): fixed sentences the engine writes from the search settings (the AI
never writes a place), a fingerprint of their meaning, and the "based on previous preferences" bookkeeping. A change of places applies to FUTURE scores only:
the places are not part of a score's input hash, each new score records the fingerprint it used, older ones are marked (previous), and only an explicit
refresh queues the ACTIVE ones again (refresh). Guarded by tests/test_score_locations.py."""
import hashlib
import json

from ..notion.search_settings import readable


def current():
    """The places as the person wrote them (no regions or AI place words added)."""
    from ..paths import load_search_config
    return load_search_config(matching=False)


def _words(fragments):
    out = []
    for fragment in fragments or []:
        word = readable(str(fragment)).strip('"').strip()
        if word and word.lower() not in [each.lower() for each in out]:
            out.append(word)
    return out


def places(search):
    """-> {preferred, acceptable, relocation: yes|no|unspecified, destinations}. No relocation key: yes when places abroad exist (as the crawl reads it)."""
    raw = (search or {}).get('locations') or {}
    abroad = _words(raw.get('abroad'))
    mode = str((raw.get('relocation') or [''])[0]).lower()
    if mode not in ('yes', 'no', 'unspecified'):
        mode = 'yes' if abroad else 'unspecified'
    return {'preferred': _words(raw.get('top_tier')), 'acceptable': _words(raw.get('country_wide')), 'relocation': mode,
            'destinations': [] if mode == 'no' else abroad}


def block(search):
    """The places as sentences for the scoring prompt ('' when none are set)."""
    found = places(search)
    lines = []
    if found['preferred']:
        lines.append(f"Preferred places: {', '.join(found['preferred'])}.")
    if found['acceptable']:
        lines.append(f"Acceptable places: {', '.join(found['acceptable'])}.")
    if found['relocation'] == 'yes' and found['destinations']:
        lines.append(f"Would relocate: yes ({', '.join(found['destinations'])}).")
    elif found['relocation'] == 'no':
        lines.append('Would relocate: no.')
    return '\n\nWhere the candidate wants to work:\n' + '\n'.join(lines) if lines else ''


def fingerprint(search):
    """A short hash of what the places MEAN (order, case, regex spelling and storage do not matter); '' when no place is set."""
    found = places(search)
    if not (found['preferred'] or found['acceptable'] or found['destinations'] or found['relocation'] == 'no'):
        return ''
    meaning = {'preferred': sorted(w.lower() for w in found['preferred']), 'acceptable': sorted(w.lower() for w in found['acceptable']),
               'relocation': found['relocation'], 'destinations': sorted(w.lower() for w in found['destinations'])}
    return hashlib.sha256(json.dumps(meaning, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:12]


def previous(scores, search):
    """Job ids whose score used other places than these ("based on previous preferences"). Scores that recorded none are not marked."""
    now = fingerprint(search)
    return [job_id for job_id, data in scores.items() if data.get('locations') and data['locations'] != now]


def refresh(db, search, active_ids):
    """The explicit refresh: queue the marked scores of ACTIVE jobs for a new score (the next searches do it). -> how many."""
    from . import score
    ids = [job_id for job_id in previous(score.load(db), search) if job_id in set(active_ids)]
    db.executemany("UPDATE scores SET input_hash='' WHERE job_id=?", [(job_id,) for job_id in ids])
    db.commit()
    return len(ids)
