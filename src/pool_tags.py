"""Finer fixed-list labels the pool shares (7 Oct 2026): country, metro area and role family of a user's own search settings.

Only these ids ever leave the machine; a search's own words never do. The site accepts the same lists (site/src/pool.js) and the central
scout publishes a label only when enough installs share it (src/scout.py fits). Which label a place or role word gets is decided by AI in
any language, from these fixed lists (src/ai/meanings.py labels; 8 Oct 2026: they were regexes in a few languages). No AI: no labels.
Tests: tests/test_pool_tags.py."""
from .ai import meanings

COUNTRIES = {
    'ch': 'Switzerland', 'de': 'Germany', 'at': 'Austria', 'fr': 'France', 'it': 'Italy', 'gb': 'United Kingdom', 'ie': 'Ireland',
    'nl': 'Netherlands', 'be': 'Belgium', 'lu': 'Luxembourg', 'es': 'Spain', 'pt': 'Portugal', 'se': 'Sweden', 'dk': 'Denmark',
    'no': 'Norway', 'fi': 'Finland', 'pl': 'Poland', 'cz': 'Czechia', 'ro': 'Romania', 'md': 'Moldova', 'gr': 'Greece',
    'us': 'United States', 'ca': 'Canada', 'au': 'Australia', 'sg': 'Singapore', 'in': 'India', 'ae': 'United Arab Emirates',
    'il': 'Israel', 'br': 'Brazil', 'mx': 'Mexico', 'jp': 'Japan',
}
METROS = {
    'ch-geneva': 'Geneva', 'ch-lausanne': 'Lausanne and Vaud', 'ch-zurich': 'Zurich', 'ch-basel': 'Basel', 'ch-bern': 'Bern',
    'ch-zug-luzern': 'Zug and Lucerne', 'ch-ticino': 'Ticino', 'ch-st-gallen': 'St. Gallen',
    'ch-fribourg-neuchatel': 'Fribourg and Neuchâtel', 'ch-valais': 'Valais', 'ch-aargau': 'Aargau (Aarau, Baden)', 'de-berlin': 'Berlin',
    'de-munich': 'Munich', 'de-hamburg': 'Hamburg', 'de-frankfurt': 'Frankfurt', 'de-cologne-dusseldorf': 'Cologne and Düsseldorf',
    'de-stuttgart': 'Stuttgart', 'at-vienna': 'Vienna', 'fr-paris': 'Paris', 'fr-lyon': 'Lyon', 'fr-annecy-grenoble': 'Annecy and Grenoble',
    'it-milan': 'Milan', 'gb-london': 'London', 'gb-manchester': 'Manchester', 'ie-dublin': 'Dublin', 'nl-amsterdam': 'Amsterdam',
    'nl-rotterdam-hague': 'Rotterdam and The Hague', 'be-brussels': 'Brussels', 'lu-luxembourg': 'Luxembourg', 'es-madrid': 'Madrid',
    'es-barcelona': 'Barcelona', 'pt-lisbon': 'Lisbon', 'pt-porto': 'Porto', 'se-stockholm': 'Stockholm', 'dk-copenhagen': 'Copenhagen',
    'no-oslo': 'Oslo', 'fi-helsinki': 'Helsinki', 'pl-warsaw': 'Warsaw', 'pl-krakow': 'Krakow', 'cz-prague': 'Prague',
    'ro-bucharest': 'Bucharest', 'md-chisinau': 'Chisinau', 'us-new-york': 'New York', 'us-bay-area': 'San Francisco Bay Area',
    'us-seattle': 'Seattle', 'us-boston': 'Boston', 'us-chicago': 'Chicago', 'us-los-angeles': 'Los Angeles', 'us-austin': 'Austin',
    'ca-toronto': 'Toronto', 'ca-vancouver': 'Vancouver', 'ca-montreal': 'Montreal', 'au-sydney': 'Sydney', 'au-melbourne': 'Melbourne',
    'sg-singapore': 'Singapore', 'in-bangalore': 'Bangalore', 'ae-dubai': 'Dubai', 'il-tel-aviv': 'Tel Aviv',
}
# Families inside the role kinds (src/role_kinds.py): what tells a photographer from a graphic designer, a nurse from a pharmacist.
FAMILIES = {
    'photography': 'photography, retouching', 'video_film': 'video, film, camera, motion',
    'graphic_design': 'graphic, UX/UI, visual design, illustration',
    'writing_content': 'writing, copywriting, journalism, content, editing',
    'marketing_social': 'marketing, social media, brand, SEO, communication', 'retail_sales': 'shop and retail sales, cashier',
    'b2b_sales': 'B2B sales, account management, business development', 'customer_service': 'customer service, call centre, help desk',
    'warehouse': 'warehouse, logistics, picking, forklift', 'driving_delivery': 'driving, delivery, courier',
    'kitchen': 'cooking, chef, pastry, bakery', 'service_hotel': 'waiting, bar, hotel, reception, housekeeping',
    'nursing_care': 'nursing, care work', 'medical': 'doctor, dentist, physiotherapy, therapy',
    'pharmacy_lab': 'pharmacy, laboratory, biology, chemistry', 'teaching': 'teaching, tutoring, lecturing',
    'childcare': 'childcare, nanny, early education', 'accounting_finance': 'accounting, controlling, finance',
    'admin_office': 'administration, office, assistant', 'hr_recruiting': 'HR, recruiting, talent',
    'legal': 'legal, lawyer, paralegal, compliance', 'construction': 'construction, carpentry, masonry, plumbing',
    'electrical_mechanical': 'electrician, mechanic, technician', 'cleaning_facility': 'cleaning, facility, caretaker',
    'security_guard': 'security guard', 'software_dev': 'software development',
    'sre_devops_cloud': 'SRE, DevOps, platform, cloud, infrastructure', 'data_ai': 'data, analytics, machine learning, AI',
    'product_project': 'product or project management', 'it_support': 'IT support, help desk',
}


def places(texts):
    """(countries, metros) named by these place words, as fixed-list ids. Switzerland, the first market, also from its fixed table
    (src/regions.py), so a Swiss search is Swiss offline and on its first run."""
    import re
    from . import regions
    swiss = ['ch'] if any(regions.region_of(t) or re.search(regions.SWITZERLAND, str(t), re.I) for t in texts) else []
    return (sorted({*swiss, *meanings.labels('pool-country', texts, COUNTRIES, 'A place a job seeker searches in. Answer the country it is in.')}),
            meanings.labels('pool-metro', texts, METROS, 'A place a job seeker searches in. Answer its metro area, or none when it is a '
                            'whole country, a region, or a place outside these areas.'))


def families(texts):
    """Role families named by these role words, as fixed-list ids."""
    return meanings.labels('pool-family', texts, FAMILIES, 'A role a job seeker looks for, in any language. Answer its family of jobs.')
