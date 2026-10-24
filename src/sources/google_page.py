"""The page the browser shows after Google's sign-in (a loopback page, so one self-contained HTML string: no outside loads).

A centred card in the app's look (amber brand tokens from desktop/renderer/tokens.css), light or dark like the desktop app (`theme`
is "light" or "dark" from the app; empty falls back to the browser's own setting), with what was allowed and what is missing.
Tests: tests/test_google_page.py."""
from html import escape

from . import google_scopes as scopes

LOGO = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="56" height="56" role="img" aria-label="Jobadabra">
<rect width="200" height="200" fill="#f5c542"/>
<path d="M52 96 L36 150 Q100 198 164 150 L148 96 Z" fill="#15171c"/>
<ellipse cx="100" cy="84" rx="94" ry="19" fill="#15171c"/>
<ellipse cx="100" cy="82" rx="56" ry="6.5" fill="#f5c542"/>
<path d="M100 4 Q107 33 133 38 Q107 43 103 66 Q102 76 100 84 Q98 76 97 66 Q93 43 67 38 Q93 33 100 4" fill="#15171c"/>
<path d="M110 90 L110 124 Q110 154 87 150 Q75 148 77 138" fill="none" stroke="#f5c542" stroke-width="21" stroke-linecap="round" stroke-linejoin="round"/>
</svg>'''

CSS = '''
:root{--bg:#eef3f7;--card:#fff;--ink:#0f1b2d;--muted:#4c5d72;--line:#d3dde7;--ok:#0e7c7b;--bad:#b42318;--glow:rgb(255 178 36/.35);--spark:#a3470f}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0b1016;--card:#121a23;--ink:#e8ecf0;--muted:#93a1b0;--line:#223040;--ok:#4fd1c5;--bad:#ff8f84;--glow:rgb(255 178 36/.22);--spark:#ffb224;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#0b1016;--card:#121a23;--ink:#e8ecf0;--muted:#93a1b0;--line:#223040;--ok:#4fd1c5;--bad:#ff8f84;--glow:rgb(255 178 36/.22);--spark:#ffb224;color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;background:var(--bg);color:var(--ink);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;overflow:hidden}
main{position:relative;width:min(100%,380px);background:var(--card);border:1px solid var(--line);border-radius:20px;padding:30px 28px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:12px;box-shadow:0 0 90px var(--glow)}
main svg{border-radius:14px}
h1{margin:0;font-size:22px;line-height:1.25}
p{margin:0;color:var(--muted);font-size:14px}
.chips{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}
.chip{border:1px solid;border-radius:99px;padding:3px 12px;font-size:13px;font-weight:600}
.chip.yes{color:var(--ok)}.chip.no{color:var(--bad)}
.spark{position:fixed;color:var(--spark);font-size:18px;animation:tw 3.2s ease-in-out infinite;pointer-events:none}
@keyframes tw{50%{opacity:.2;transform:scale(.7)}}
@media (prefers-reduced-motion:reduce){.spark{animation:none}}
'''


def render(parts, theme='', failed=None):
    """The page. `parts` = allowed parts (None when the sign-in failed); `failed` = a short reason."""
    if failed is not None:
        title, line, chips = 'Sign-in did not finish', f'{failed}. Go back to Jobadabra and try again. You can close this tab.', ''
    elif not parts:
        title, line, chips = 'Nothing was allowed', 'Connect again in Jobadabra and tick both boxes on the Google screen. You can close this tab.', ''
    else:
        gone = scopes.missing(parts)
        title = "You're connected" if not gone else 'Connected, one part missing'
        line = ('Gmail and Calendar are on. You can close this tab and go back to Jobadabra.' if not gone
                else f'{scopes.PART_NAMES[gone[0]]} was not allowed, so {scopes.WHAT_IT_LOSES[gone[0]]}. '
                     'To add it, open Jobadabra, Settings, Gmail & Calendar, Reconnect. You can close this tab.')
        chips = '<div class="chips">' + ''.join(
            f'<span class="chip {"yes" if part in parts else "no"}">{scopes.PART_NAMES[part]} {"✓" if part in parts else "not allowed"}</span>'
            for part in scopes.SCOPE_URLS) + '</div>'
    attr = f' data-theme="{theme}"' if theme in ('light', 'dark') else ''
    return (f'<!doctype html><html lang="en"{attr}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            f'<title>Jobadabra</title><style>{CSS}</style></head><body>'
            '<span class="spark" style="top:12%;left:14%" aria-hidden="true">✦</span><span class="spark" style="bottom:16%;right:12%;animation-delay:1.2s" aria-hidden="true">✦</span>'
            f'<main>{LOGO}<h1>{escape(title)}</h1>{chips}<p>{escape(line)}</p></main></body></html>')
