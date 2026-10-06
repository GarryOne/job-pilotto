"""Finer fixed-list labels the pool shares (7 Oct 2026): country, metro area and role family of a user's own search settings.

Only these names ever leave the machine; a search's own words never do. The site accepts the same lists (site/src/pool.js) and the central
scout publishes a label only when enough installs share it (src/scout.py fits)."""
import re

COUNTRIES = {
    'ch': r'switzerland|schweiz|suisse|svizzera|z[uü]rich|gen[eè]v|geneva|basel|bern|lausanne|lugano|luzern|lucerne|zug|winterthur|st\.? ?gallen|fribourg|neuch[aâ]tel|\bsion\b|valais|vaud|ticino',
    'de': r'germany|deutschland|berlin|m[uü]nchen|munich|hamburg|frankfurt|k[oö]ln|cologne|stuttgart|d[uü]sseldorf|leipzig',
    'at': r'austria|[oö]sterreich|vienna|wien|graz|linz|salzburg',
    'fr': r'\bfrance\b|paris|lyon|marseille|toulouse|\bnice\b|bordeaux|lille|annecy|grenoble',
    'it': r'italy|italia|milan|milano|\brome\b|\broma\b|turin|torino',
    'gb': r'united kingdom|\buk\b|england|london|manchester|edinburgh|glasgow|bristol|cambridge|oxford',
    'ie': r'ireland|dublin|cork',
    'nl': r'netherlands|nederland|amsterdam|rotterdam|utrecht|eindhoven|the hague',
    'be': r'belgium|belgique|brussels|bruxelles|antwerp|ghent',
    'lu': r'luxembourg',
    'es': r'spain|espa[nñ]a|madrid|barcelona|valencia|seville|malaga',
    'pt': r'portugal|lisbon|lisboa|porto',
    'se': r'sweden|stockholm|gothenburg|malm[oö]',
    'dk': r'denmark|copenhagen',
    'no': r'norway|oslo',
    'fi': r'finland|helsinki',
    'pl': r'poland|warsaw|krak[oó]w|wroc[lł]aw|gda[nń]sk',
    'cz': r'czech|prague|praha|brno',
    'ro': r'romania|bucharest|cluj',
    'md': r'moldova|chi[sș]in[aă]u',
    'gr': r'greece|athens',
    'us': r'united states|\busa?\b|new york|san francisco|seattle|austin|boston|chicago|los angeles|denver|miami',
    'ca': r'canada|toronto|vancouver|montr[eé]al|ottawa|calgary',
    'au': r'australia|sydney|melbourne|brisbane',
    'sg': r'singapore',
    'in': r'\bindia\b|bangalore|bengaluru|mumbai|hyderabad|pune|delhi|chennai',
    'ae': r'united arab emirates|\buae\b|dubai|abu dhabi',
    'il': r'israel|tel aviv',
    'br': r'brazil|brasil|s[aã]o paulo|rio de janeiro',
    'mx': r'mexico|m[eé]xico',
    'jp': r'japan|tokyo|osaka',
}
METROS = {
    'ch-geneva': r'gen[eè]v|geneva|genf|carouge|meyrin|nyon',
    'ch-lausanne': r'lausanne|vaud|vevey|montreux|morges|renens',
    'ch-zurich': r'z[uü]rich|winterthur|kloten|d[uü]bendorf|uster',
    'ch-basel': r'basel|b[aâ]le|allschwil|muttenz',
    'ch-bern': r'\bbern|berne|biel|bienne|thun',
    'ch-zug-luzern': r'\bzug\b|luzern|lucerne|baar|cham\b',
    'ch-ticino': r'lugano|ticino|bellinzona|locarno|mendrisio',
    'ch-st-gallen': r'st\.? ?gallen|st\.? ?gall',
    'ch-fribourg-neuchatel': r'fribourg|freiburg|neuch[aâ]tel|la chaux',
    'ch-valais': r'valais|wallis|\bsion\b|sierre|martigny|visp',
    'ch-aargau': r'aargau|aarau|baden\b|brugg',
    'de-berlin': r'berlin', 'de-munich': r'm[uü]nchen|munich', 'de-hamburg': r'hamburg', 'de-frankfurt': r'frankfurt',
    'de-cologne-dusseldorf': r'k[oö]ln|cologne|d[uü]sseldorf|bonn', 'de-stuttgart': r'stuttgart',
    'at-vienna': r'vienna|wien', 'fr-paris': r'paris|[iî]le.de.france|la d[eé]fense', 'fr-lyon': r'\blyon', 'fr-annecy-grenoble': r'annecy|grenoble|haute.savoie',
    'it-milan': r'milan|milano', 'gb-london': r'london', 'gb-manchester': r'manchester', 'ie-dublin': r'dublin',
    'nl-amsterdam': r'amsterdam|haarlem', 'nl-rotterdam-hague': r'rotterdam|the hague|den haag', 'be-brussels': r'brussels|bruxelles',
    'lu-luxembourg': r'luxembourg', 'es-madrid': r'madrid', 'es-barcelona': r'barcelona', 'pt-lisbon': r'lisbon|lisboa', 'pt-porto': r'porto\b',
    'se-stockholm': r'stockholm', 'dk-copenhagen': r'copenhagen', 'no-oslo': r'oslo', 'fi-helsinki': r'helsinki',
    'pl-warsaw': r'warsaw|warszawa', 'pl-krakow': r'krak[oó]w', 'cz-prague': r'prague|praha', 'ro-bucharest': r'bucharest|bucure[sș]ti',
    'md-chisinau': r'chi[sș]in[aă]u', 'us-new-york': r'new york|\bnyc\b|brooklyn', 'us-bay-area': r'san francisco|bay area|palo alto|san jose|mountain view',
    'us-seattle': r'seattle', 'us-boston': r'boston', 'us-chicago': r'chicago', 'us-los-angeles': r'los angeles', 'us-austin': r'austin',
    'ca-toronto': r'toronto', 'ca-vancouver': r'vancouver', 'ca-montreal': r'montr[eé]al', 'au-sydney': r'sydney', 'au-melbourne': r'melbourne',
    'sg-singapore': r'singapore', 'in-bangalore': r'bangalore|bengaluru', 'ae-dubai': r'dubai', 'il-tel-aviv': r'tel aviv',
}
# Families inside the role kinds (src/role_kinds.py): what tells a photographer from a graphic designer, a nurse from a pharmacist.
FAMILIES = {
    'photography': r'photo|fotograf|retouch|retouche|bildbearbeit',
    'video_film': r'video|film|camera|kamera|editor vid|montage|motion',
    'graphic_design': r'graphi|grafik|designer|illustrat|\bux\b|\bui\b|visual',
    'writing_content': r'writer|copywrit|redakt|r[eé]dact|journalist|content|editor\b|texter',
    'marketing_social': r'marketing|social media|community manager|brand|seo|communication',
    'retail_sales': r'vendeu|verk[aä]uf|sales assistant|shop|store|retail|cashier|caissi|kassier|boutique',
    'b2b_sales': r'account (executive|manager)|business development|key account|sales (manager|representative)|aussendienst|commercial',
    'customer_service': r'customer (service|support|care)|kundendienst|service client|call center|help ?desk',
    'warehouse': r'warehouse|lager|entrep[oô]t|magasinier|logisti|picker|forklift|stapler',
    'driving_delivery': r'driver|chauffeur|fahrer|delivery|livreu|courier|kurier',
    'kitchen': r'cook|chef|cuisin|koch|k[uü]che|kitchen|p[aâ]tissi|baker|b[aä]cker|boulang',
    'service_hotel': r'waiter|serveu|kellner|barista|bartender|barkeeper|hotel|r[eé]ception|housekeep|concierge|service staff',
    'nursing_care': r'nurse|nursing|infirmi|pflege|care (worker|assistant)|aide.soignant|caregiver|betreuung',
    'medical': r'doctor|physician|m[eé]decin|arzt|[aä]rztin|dentist|physio|therap|radiolog',
    'pharmacy_lab': r'pharma|apothek|laborat|lab tech|biolog|chemist',
    'teaching': r'teacher|enseignant|lehrer|lehrperson|tutor|professeur|lecturer',
    'childcare': r'childcare|nanny|kita|cr[eè]che|[eé]ducat|kinderbetreu|daycare',
    'accounting_finance': r'account(ant|ing)|comptab|buchhalt|controller|finance|treasury|audit|fiduciaire|treuhand',
    'admin_office': r'\badmin\b|administrat|(office|executive|administrative|personal) assistant|assistant\w* de direction|secr[eé]tar|office manager|empfang|sachbearbeit|back.?office',
    'hr_recruiting': r'\bhr\b|human resources|recruit|talent|ressources humaines|personal',
    'legal': r'legal|lawyer|avocat|jurist|anwalt|paralegal|compliance',
    'construction': r'construct|bau|ma[cç]on|carpent|zimmer|schreiner|menuisier|plumb|sanit|install',
    'electrical_mechanical': r'electric|[eé]lectric|elektrik|mechanic|m[eé]cani|mechanik|technician|techniker|automation',
    'cleaning_facility': r'clean|nettoy|reinigung|facility|hauswart|concierge d.immeuble|janitor',
    'security_guard': r'security guard|agent de s[eé]curit|sicherheitsdienst|guard',
    'software_dev': r'software|developer|d[eé]veloppeu|entwickler|programm|backend|frontend|full.?stack',
    'sre_devops_cloud': r'\bsre\b|devops|site reliability|platform|cloud|infrastructure|sysadmin',
    'data_ai': r'\bdata\b|analyst|analytics|machine learning|\bml\b|\bai\b|scientist',
    'product_project': r'product (manager|owner)|project manager|chef de projet|projektleit|scrum',
    'it_support': r'it support|help ?desk|support technician|informatik.*support|technicien informatique',
}
_COUNTRIES = {k: re.compile(v, re.I) for k, v in COUNTRIES.items()}
_METROS = {k: re.compile(v, re.I) for k, v in METROS.items()}
_FAMILIES = {k: re.compile(v, re.I) for k, v in FAMILIES.items()}


def places(texts):
    """(countries, metros) named by these place words, as fixed-list ids."""
    return (sorted({k for k, rx in _COUNTRIES.items() if any(rx.search(t) for t in texts)}),
            sorted({k for k, rx in _METROS.items() if any(rx.search(t) for t in texts)}))


def families(texts):
    """Role families named by these role words, as fixed-list ids."""
    return sorted({k for k, rx in _FAMILIES.items() if any(rx.search(t) for t in texts)})
