"""The Jobadabra mark (a top hat with a J and a spark) as one vector definition: writes the SVGs and draws the PNG icons from the same shapes."""
from PIL import Image, ImageDraw

INK, YELLOW, PAPER = '#15171c', '#f5c542', '#faf8f3'
SIZE = 200  # the mark's own box; everything below is in these units

# Each shape: ('poly', path commands, role) or ('ellipse', cx, cy, rx, ry, role) or ('stroke', points, width, role).
# Roles: spark (the star), hat (brim and body), cut (the brim opening and the J, shown in the background colour).
SHAPES = [
    ('path', [('M', 52, 96), ('L', 36, 150), ('Q', 100, 198, 164, 150), ('L', 148, 96), ('Z',)], 'hat'),
    ('ellipse', 100, 84, 94, 19, 'hat'),
    ('ellipse', 100, 82, 56, 6.5, 'cut'),
    # The spark rises out of the opening on a short stem (drawn after the opening so the stem shows in it).
    ('path', [('M', 100, 4), ('Q', 107, 33, 133, 38), ('Q', 107, 43, 103, 66), ('Q', 102, 76, 100, 84), ('Q', 98, 76, 97, 66), ('Q', 93, 43, 67, 38), ('Q', 93, 33, 100, 4)], 'spark'),
    ('stroke', [('M', 110, 90), ('L', 110, 124), ('Q', 110, 154, 87, 150), ('Q', 75, 148, 77, 138)], 21, 'cut'),
]


def colours(on):
    """(spark, hat, cut) for a background: 'light' page, 'dark' page, or the yellow 'tile'."""
    return {'light': (YELLOW, INK, PAPER), 'dark': (YELLOW, YELLOW, INK), 'tile': (INK, INK, YELLOW)}[on]


def _flatten(cmds, steps=24):
    pts, cur = [], (0, 0)
    for c in cmds:
        if c[0] in 'ML':
            cur = (c[1], c[2]); pts.append(cur)
        elif c[0] == 'Q':
            (x0, y0), (x1, y1), (x2, y2) = cur, (c[1], c[2]), (c[3], c[4])
            for i in range(1, steps + 1):
                t = i / steps
                pts.append(((1 - t) ** 2 * x0 + 2 * (1 - t) * t * x1 + t * t * x2, (1 - t) ** 2 * y0 + 2 * (1 - t) * t * y1 + t * t * y2))
            cur = (x2, y2)
    return pts


def _d(cmds):
    return ' '.join(c[0] + ' '.join(f'{v:g}' for v in c[1:]) for c in cmds)


def svg(on, size=SIZE, background=False):
    spark, hat, cut = colours(on)
    role = {'spark': spark, 'hat': hat, 'cut': cut}
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SIZE} {SIZE}" width="{size}" height="{size}">']
    if background:
        out.append(f'<rect width="{SIZE}" height="{SIZE}" fill="{cut}"/>')
    for s in SHAPES:
        if s[0] == 'path':
            out.append(f'<path d="{_d(s[1])}" fill="{role[s[2]]}"/>')
        elif s[0] == 'ellipse':
            out.append(f'<ellipse cx="{s[1]}" cy="{s[2]}" rx="{s[3]}" ry="{s[4]}" fill="{role[s[5]]}"/>')
        else:
            out.append(f'<path d="{_d(s[1])}" fill="none" stroke="{role[s[3]]}" stroke-width="{s[2]}" stroke-linecap="round" stroke-linejoin="round"/>')
    out.append('</svg>')
    return '\n'.join(out)


def draw(on, px, transparent=True):
    """The mark as an RGBA image px wide (4x supersampled)."""
    k = 4 * px / SIZE
    img = Image.new('RGBA', (px * 4, px * 4), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    spark, hat, cut = colours(on)
    role = {'spark': spark, 'hat': hat, 'cut': cut}
    for s in SHAPES:
        if s[0] == 'path':
            d.polygon([(x * k, y * k) for x, y in _flatten(s[1])], fill=role[s[2]])
        elif s[0] == 'ellipse':
            d.ellipse([(s[1] - s[3]) * k, (s[2] - s[4]) * k, (s[1] + s[3]) * k, (s[2] + s[4]) * k], fill=role[s[5]])
        else:
            pts = [(x * k, y * k) for x, y in _flatten(s[1])]
            r = s[2] * k / 2  # a round pen: a disc at every flattened point (PIL's wide lines spike at curves)
            fine = [(pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t / 40, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t / 40) for i in range(len(pts) - 1) for t in range(40)] + pts[-1:]
            for x, y in fine:
                d.ellipse([x - r, y - r, x + r, y + r], fill=role[s[3]])
    return img.resize((px, px), Image.LANCZOS)
