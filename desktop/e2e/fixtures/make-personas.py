"""Writes fixtures/personas/<name>/: cv.pdf, profile.json and feeds/ for the personas suite (suites/personas.mjs). Two fictional users, neither
Swiss nor European-by-default: a data analyst in Austin (US citizen) and a marketing manager in São Paulo (Brazilian, open to Portugal and Spain).
Run once from desktop/e2e/fixtures; the output is committed so the test needs no tooling. cv.pdf is built like make-cv.py's."""
import json
import os


def pdf(lines):
    esc = lambda t: t.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
    stream = 'BT /F1 10 Tf 40 800 Td 14 TL\n' + '\n'.join(f'({esc(l)}) Tj T*' for l in lines) + '\nET'
    objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
               '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
               f'<< /Length {len(stream)} >>\nstream\n{stream}\nendstream', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
    out, offsets = '%PDF-1.4\n', []
    for n, body in enumerate(objects, 1):
        offsets.append(len(out.encode('latin-1')))
        out += f'{n} 0 obj\n{body}\nendobj\n'
    xref = len(out.encode('latin-1'))
    out += f'xref\n0 {len(objects) + 1}\n0000000000 65535 f \n' + ''.join(f'{o:010d} 00000 n \n' for o in offsets)
    return (out + f'trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n').encode('latin-1')


def posting(i, title, where, text, salary=''):
    return {'id': i, 'title': title, 'location': {'name': where}, 'absolute_url': f'https://boards.e2e.test/job/{i}', 'updated_at': '2026-10-01T09:00:00Z',
            'content': f'<p>{text}{(" " + salary) if salary else ""}</p>'}


PERSONAS = {
    'austin': {
        'cv': ['Jordan Rivera', 'Senior Data Analyst, Austin, Texas, USA', 'jordan.rivera@example.test', '', 'SUMMARY',
               'Data analyst with 7 years of experience in business intelligence, SQL and experimentation.',
               'US citizen. Open to remote work within the United States.', '', 'EXPERIENCE',
               'Senior Data Analyst, Lone Star Retail, Austin (2021 - present)',
               '- Built the Looker and dbt reporting layer used by 40 managers; cut report time by 60 percent.',
               'Data Analyst, Capital Metrics, Dallas (2018 - 2021)', '- Modelled churn in Python and Snowflake; ran 30 A/B tests.',
               '', 'SKILLS', 'SQL, Python, dbt, Looker, Tableau, Snowflake, Excel', '', 'EDUCATION', 'BA Statistics, Example State University',
               '', 'LANGUAGES', 'English (native), Spanish (B1)'],
        'profile': {
            'name': 'Jordan Rivera (data analyst, Austin, US citizen)', 'city': 'Austin, Texas, USA', 'citizenship': 'United States', 'work_rights': ['united states'],
            'places': {'top_tier': ['austin'], 'country_wide': ['united states', 'texas', 'dallas', 'houston'], 'abroad': ['portugal']},
            'languages': ['English'], 'currency': '$', 'remote': True, 'timezone': 'America/Chicago',
            'roles': ['data analyst', 'business intelligence', '\\bbi\\b', 'analytics engineer'],
            'expect': {'noSponsorship': ['Austin', 'Dallas', 'Remote'], 'sponsorship': ['Lisbon'], 'currency': '$95,000'},
            'google': {'queries': ['data analyst'], 'country': 'us', 'locations': [{'location': 'Austin,Texas,United States', 'language': 'en'}]},
            'board': 'data analyst'},
        'jobs': {
            'acme': [posting(2001, 'Senior Data Analyst', 'Austin, TX', 'Own self-serve analytics in Looker and dbt on Snowflake. SQL and Python. Hybrid in Austin, English.', 'Salary $95,000 - $120,000 a year.'),
                     posting(2002, 'Analytics Engineer', 'Lisbon, Portugal', 'Build dbt models on Snowflake for a European fintech. SQL, Python, Looker. Hybrid in Lisbon. English working language.'),
                     posting(2003, 'Account Executive', 'Austin, TX', 'Quota-carrying enterprise sales role.'),
                     posting(2004, 'Data Analyst Intern', 'Austin, TX', 'Summer internship for students.')],
            'beta': [posting(2101, 'Business Intelligence Analyst', 'Remote, United States', 'Remote across the US: Power BI, Tableau and SQL for a logistics team. Pay range $88,000 - $105,000.'),
                     posting(2102, 'Data Analyst', 'Dallas, Texas', 'SQL, Python, dbt for an energy marketer. Hybrid in Dallas.'),
                     posting(2103, 'Product Designer', 'Austin, TX', 'Design the product UI.')],
            'gamma': [posting(2201, 'Data Analyst', 'Austin, TX', 'Join our analytics team in Austin: SQL, Looker, Snowflake.')]}},
    'sao_paulo': {
        'cv': ['Camila Souza', 'Gerente de Marketing, Sao Paulo, Brasil', 'camila.souza@example.test', '', 'RESUMO',
               'Marketing manager with 10 years of experience in growth, brand and performance marketing. Brazilian citizen.',
               'Open to roles in Portugal and Spain (would need a work visa).', '', 'EXPERIENCE',
               'Marketing Manager, Loja Aurora, Sao Paulo (2020 - present)',
               '- Led a team of 6; grew paid acquisition 3x with a flat budget; ran CRM and lifecycle campaigns.',
               'Marketing Analyst, Agencia Norte, Sao Paulo (2016 - 2020)', '- Planned campaigns across Google Ads, Meta and email.',
               '', 'SKILLS', 'Google Ads, Meta Ads, HubSpot, SEO, CRM, Google Analytics', '', 'EDUCATION', 'Bacharel em Administracao, Universidade Exemplo',
               '', 'LANGUAGES', 'Portuguese (native), English (C1), Spanish (B2)'],
        'profile': {
            'name': 'Camila Souza (marketing manager, Sao Paulo, Brazilian)', 'city': 'São Paulo, Brazil', 'citizenship': 'Brazil', 'work_rights': ['brazil'],
            'places': {'top_tier': ['s[aã]o paulo'], 'country_wide': ['brazil', 'brasil', 'rio de janeiro', 'curitiba'], 'abroad': ['portugal', 'lisbon', 'spain', 'madrid']},
            'languages': ['Portuguese', 'English', 'Spanish'], 'currency': 'R$', 'remote': True, 'timezone': 'America/Sao_Paulo',
            'roles': ['marketing manager', 'gerente de marketing', 'growth marketing', 'performance marketing'],
            'expect': {'noSponsorship': ['São Paulo', 'Remote'], 'sponsorship': ['Lisbon', 'Madrid'], 'currency': 'R$ 14.000'},
            'google': {'queries': ['gerente de marketing'], 'country': 'br', 'locations': [{'location': 'Sao Paulo,State of Sao Paulo,Brazil', 'language': 'pt'}]},
            'board': 'marketing'},
        'jobs': {
            'acme': [posting(3001, 'Gerente de Marketing', 'São Paulo, Brazil', 'Lidere campanhas de performance e CRM. Google Ads, Meta Ads, HubSpot. Híbrido em São Paulo. Português fluente.', 'Salário: R$ 14.000 - R$ 18.000 por mês.'),
                     posting(3002, 'Marketing Manager', 'Lisbon, Portugal', 'Own growth marketing for a Lisbon start-up: paid, SEO and CRM. Hybrid in Lisbon. English working language.'),
                     posting(3003, 'Sales Executive', 'São Paulo, Brazil', 'Vendas externas, meta mensal.'),
                     posting(3004, 'Marketing Intern', 'São Paulo, Brazil', 'Estágio de marketing para estudantes.')],
            'beta': [posting(3101, 'Growth Marketing Manager', 'Remote, LATAM', 'Remote across Latin America: paid acquisition, lifecycle and SEO. Google Ads, HubSpot. Pay R$ 15.000 - R$ 20.000 per month.'),
                     posting(3102, 'Marketing Manager', 'Madrid, Spain', 'Lead marketing for a Madrid scale-up: brand, performance and CRM. Hybrid in Madrid. Spanish and English.'),
                     posting(3103, 'Product Designer', 'São Paulo, Brazil', 'Design the product UI.')],
            'gamma': [posting(3201, 'Marketing Manager', 'São Paulo, Brazil', 'Lidere o marketing de uma marca em São Paulo: performance, CRM, marca.')]}},
}

for name, persona in PERSONAS.items():
    folder = os.path.join('personas', name)
    os.makedirs(os.path.join(folder, 'feeds'), exist_ok=True)
    open(os.path.join(folder, 'cv.pdf'), 'wb').write(pdf(persona['cv']))
    json.dump(persona['profile'], open(os.path.join(folder, 'profile.json'), 'w'), indent=1, ensure_ascii=False)
    for board, jobs in persona['jobs'].items():
        json.dump({'jobs': jobs}, open(os.path.join(folder, 'feeds', f'{board}.json'), 'w'), indent=1, ensure_ascii=False)
    for shared in ('sources.json', 'routes.json'):
        open(os.path.join(folder, 'feeds', shared), 'w').write(open(os.path.join('feeds', shared)).read())
    open(os.path.join(folder, 'feeds', 'scout_seeds.json'), 'w').write(open(os.path.join('feeds', 'scout_seeds.json')).read())
    print(folder, 'written')
