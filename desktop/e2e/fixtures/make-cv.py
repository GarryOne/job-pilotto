"""Writes fixtures/cv.pdf: a one-page, fictional CV for the end-to-end journey (plain text, no fonts to embed).
Run once; the PDF is committed so the test needs no tooling."""
LINES = [
    'Alex Example', 'Senior Site Reliability Engineer, Zurich, Switzerland', 'alex.example@example.test',
    '', 'SUMMARY',
    'Site reliability engineer with 9 years of experience in cloud infrastructure, Kubernetes, observability',
    'and incident response. Prefers distributed systems and platform engineering roles.',
    '', 'EXPERIENCE',
    'Senior SRE, Acme Cloud, Zurich (2022 - present)',
    '- Ran 400 microservices on Kubernetes (AWS EKS); cut incident time by 40 percent with Datadog and OpenTelemetry.',
    '- Built the Terraform platform used by 120 engineers; led the on-call rotation of 8 people.',
    'Platform Engineer, Beta Systems, Berlin (2018 - 2022)',
    '- Migrated 60 services to Kubernetes; introduced SLOs and error budgets.',
    '', 'SKILLS', 'Kubernetes, Terraform, AWS, Python, Go, Datadog, Prometheus, Grafana, PostgreSQL',
    '', 'EDUCATION', 'BSc Computer Science, Example University',
    '', 'LANGUAGES', 'English (fluent), German (B1)',
]


def escape(text):
    return text.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')


stream = 'BT /F1 10 Tf 40 800 Td 14 TL\n' + '\n'.join(f'({escape(line)}) Tj T*' for line in LINES) + '\nET'
objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    f'<< /Length {len(stream)} >>\nstream\n{stream}\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
]
out, offsets = '%PDF-1.4\n', []
for number, body in enumerate(objects, 1):
    offsets.append(len(out.encode('latin-1')))
    out += f'{number} 0 obj\n{body}\nendobj\n'
xref = len(out.encode('latin-1'))
out += f'xref\n0 {len(objects) + 1}\n0000000000 65535 f \n' + ''.join(f'{o:010d} 00000 n \n' for o in offsets)
out += f'trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'
open('fixtures/cv.pdf', 'wb').write(out.encode('latin-1'))
print('fixtures/cv.pdf written')
