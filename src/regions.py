"""Place words that stand for many places. A search that says "Switzerland" must find a job posted as "Lausanne", and "Romandie" must find
Geneva, Vaud and Neuchâtel: a posting's location is usually a city, rarely the country or the region.

Fixed words in, fixed words out (same rule as coverage.PLACE_OPTIONS): the table below is the only source of the expansion, nothing a server or
a posting says becomes a pattern. A place the user wrote that is not in the table (a city, a country elsewhere) is left exactly as written.
`expand()` runs when the settings are read (paths.load_search_config); the cached settings and the Notion page keep the user's own word.
"""
import re
import unicodedata

# Cities and towns with their own job markets, each as a regex fragment (accents and the common German, French, Italian and English spellings).
ZURICH = r'z(?:[uü]|ue)rich|winterthur|\buster\b|d[uü]bendorf|wallisellen|opfikon|kloten|glattbrugg|schlieren|dietikon|w[aä]denswil|horgen|thalwil|pf[aä]ffikon|volketswil|regensdorf'
BASEL = r'basel|bâle|liestal|muttenz|pratteln|allschwil|riehen|binningen|reinach|arlesheim|rheinfelden'
# A fragment that is also inside a longer word is anchored (#278, 5 Oct 2026): 'biel' was in Bielefeld, 'baden' in Baden-Württemberg, 'freiburg' in Freiburg im Breisgau, 'uster' in Custer,
# 'nyon' in Canyon, 'genf' in Klagenfurt (7 Oct 2026), 'sion' in Mission, 'arbon' in Carbonia, 'thun' in Thunder Bay, 'stans' in Stansted: German and other towns that let a wrong job in and cost an AI scoring.
BIEL = r'\bbiel\b|bienne'
FRIBOURG = r'fribourg|freiburg(?!\s+(?:im\s+breisgau|i\.\s*br))'
BERN = r'\bbern\b|\bberne\b|' + BIEL + r'|\bthun\b|k[oö]niz|burgdorf|langenthal|solothurn|aarau|\bolten\b|(?<![-\w])baden\b(?!-)|' + FRIBOURG + r'|schwarzenburg'
GENEVA = r'gen[eè]v[ea]?|\bgenf\b|lausanne|\bnyon\b|morges|vevey|montreux|renens|yverdon|\bpully\b|meyrin|carouge'
OTHER_ROMANDIE = r'neuch[aâ]tel|\bsion\b|sitten|delémont|del[eé]mont|martigny|sierre|monthey|la chaux-de-fonds'
CENTRAL = r'l[uü]cerne?|luzern|\bzug\b|\bcham\b|\bbaar\b|schwyz|altdorf|\bstans\b|sarnen|\bkriens\b|\bemmen\b'
EAST = r'st\.? ?gallen|saint-gall|\bchur\b|frauenfeld|herisau|rapperswil|davos|schaffhausen|kreuzlingen|\barbon\b|\bwil\b|appenzell|glarus|\bbuchs\b'
TICINO = r'lugano|bellinzona|locarno|mendrisio|chiasso|ticino|tessin|\bcadenazzo\b|\bmanno\b'
COUNTRY_WORDS = r'switzerland|schweiz|suisse|svizzera|svizra|\bch\b|\bsui\b'

SWITZERLAND = '|'.join((ZURICH, BASEL, BERN, GENEVA, OTHER_ROMANDIE, CENTRAL, EAST, TICINO, COUNTRY_WORDS))

# name -> (the words a user may write for it, the places it stands for)
REGIONS = {
    'Switzerland': (('switzerland', 'schweiz', 'suisse', 'svizzera', 'svizra', 'swiss', 'ch', 'whole switzerland', 'all of switzerland'), SWITZERLAND),
    'Romandie': (('romandie', 'suisse romande', 'french speaking switzerland', 'western switzerland', 'westschweiz', 'welschschweiz', 'svizzera francese'),
                 '|'.join((GENEVA, OTHER_ROMANDIE, FRIBOURG + '|' + BIEL + r'|\bvaud\b|valais|wallis|\bjura\b'))),
    'German-speaking Switzerland': (('deutschschweiz', 'german speaking switzerland', 'suisse alémanique', 'suisse alemanique', 'svizzera tedesca'),
                                    '|'.join((ZURICH, BASEL, BERN, CENTRAL, EAST))),
    'Ticino': (('ticino', 'tessin', 'italian speaking switzerland', 'svizzera italiana', 'suisse italienne'), TICINO),
    'Greater Zurich': (('greater zurich', 'zurich area', 'zurich region', 'grossraum zurich', 'region zurich', 'zurich metropolitan area'), ZURICH + r'|\bzug\b'),
    'Basel region': (('basel region', 'basel area', 'nordwestschweiz', 'northwestern switzerland', 'region basel', 'regio basiliensis'), BASEL),
    'Lake Geneva': (('lake geneva', 'arc lemanique', 'lac leman', 'genfersee', 'geneva area', 'geneva region'), GENEVA),
    'Central Switzerland': (('central switzerland', 'zentralschweiz', 'suisse centrale'), CENTRAL),
    'Eastern Switzerland': (('eastern switzerland', 'ostschweiz', 'suisse orientale'), EAST),
    'Mittelland': (('mittelland', 'espace mittelland', 'swiss plateau', 'bern region', 'region bern'), BERN),
}


def _key(text):
    """A place as written (a regex fragment from the settings, or a plain word) -> one comparable form: "\\bz[uü]rich area\\b" -> "zurich area"."""
    text = re.sub(r'\[(\w)(\w)\]', lambda m: m.group(2) if ord(m.group(2)) > 127 else m.group(1), str(text))   # z[uü]rich -> zürich
    text = re.sub(r'\\b|\\|["\']', '', text)
    text = ''.join(c for c in unicodedata.normalize('NFKD', text) if not unicodedata.combining(c))
    return ' '.join(re.sub(r'[-_/.]+', ' ', text.lower()).split())


_BY_WORD = {_key(word): name for name, (words, _) in REGIONS.items() for word in (*words, name)}


def region_of(fragment):
    """The region a place word stands for ("Romandie", "Deutschschweiz", "Switzerland"), or None for any other place."""
    return _BY_WORD.get(_key(fragment))


def expand(fragments):
    """The place fragments with every region word replaced by the places it stands for; everything else as written, in order."""
    out = []
    for fragment in fragments or []:
        name = region_of(fragment)
        out.append(f'(?:{REGIONS[name][1]})' if name else fragment)
    return out
