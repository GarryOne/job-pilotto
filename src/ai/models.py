"""The model of the small AI steps (title, page and place checks, triage, search picks, stage 1 facts, mail), as data.

The app sets JOB_PILOTTO_SMALL_MODEL on this Mac and as a variable in the user's Always on repo (desktop/lib/github.js), so a newer
model reaches an install without a new engine release: an Always on repo runs the engine of the app's own release, which never
changes (8 Oct 2026: Haiku 4.5 -> 5.5). The literal below is only the fallback when nothing set it.
"""
import os

SMALL_MODEL = os.getenv('JOB_PILOTTO_SMALL_MODEL') or 'claude-haiku-5-5'
