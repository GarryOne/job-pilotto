#!/usr/bin/env python3
"""Discover employers from the Swiss job boards (jobs.ch, SwissDevJobs, TechTree), then follow career links. Runs only when the
user's places include Switzerland: those boards list nothing elsewhere."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from html import escape, unescape
from html.parser import HTMLParser
import csv
import hashlib
import json
from pathlib import Path
import re
import time
from urllib.parse import urljoin, urlsplit, urlencode
import os
from urllib.request import Request, urlopen

from ..paths import DATA, REPORTS, keyword_regex, load_search_config
from .feeds import wanted_title
_SEARCH = load_search_config()
ROLE = keyword_regex(_SEARCH['board_discovery_keywords'])
CAREER = re.compile(r'career|karriere|carrière|carriere|stellen|vacanc|recruit|join.?us|offene.?jobs|work.with.us|/jobs(?:/|$)', re.I)
ATS = {'greenhouse.io':'Greenhouse','lever.co':'Lever','ashbyhq.com':'Ashby','smartrecruiters.com':'SmartRecruiters','myworkdayjobs.com':'Workday','successfactors.com':'SAP SuccessFactors','successfactors.eu':'SAP SuccessFactors','teamtailor.com':'Teamtailor','personio.de':'Personio','personio.com':'Personio','recruitee.com':'Recruitee','apply.workable.com':'Workable','hr4you.com':'HR4YOU'}
CITIES = {'zurich':['zürich','zurich','zuerich'], 'geneva':['genève','geneva','genf'], 'lausanne':['lausanne'], 'basel':['basel','bâle'], 'bern':['bern','berne'], 'zug':['zug'], 'winterthur':['winterthur'], 'lucerne':['luzern','lucerne'], 'st. gallen':['st. gallen','st.gallen'], 'lugano':['lugano']}


SWISS_PLACE = re.compile(r'switzerland|swiss|schweiz|suisse|svizzera|z[uü]e?rich|gen[eè]v|basel|b[aâ]le|bern|lausanne|\bzug\b|lugano|winterthur|luzern|lucerne|st\.? gallen', re.I)


def swiss_places(config):
    """True when the places the user searches in (config/search.json locations) include Switzerland."""
    places = config.get('locations') or {}
    return any(SWISS_PLACE.search(str(p)) for key in ('top_tier', 'country_wide', 'abroad') for p in places.get(key) or [])


def text(s):
    return re.sub(r'\s+', ' ', unescape(re.sub('<[^>]+>', ' ', s))).strip()


def city(location):
    found = [name.title() for name, aliases in CITIES.items() if any(re.search(r'(?<!\w)'+re.escape(a)+r'(?!\w)',location,re.I) for a in aliases)]
    return ', '.join(found) or location or 'Unspecified'


def mode(value):
    if re.search(r'hybrid|hybride', value, re.I): return 'Hybrid (stated)'
    if re.search(r'fully remote|100.?% remote|TELECOMMUTE', value, re.I): return 'Remote (stated)'
    if re.search(r'remote|home.?office|télétravail', value, re.I): return 'Remote mentioned; verify conditions'
    return 'Not stated'


class Page(HTMLParser):
    def __init__(self, source):
        super().__init__(); self.links=[]; self.schemas=[]; self.anchor=None; self.script=None
        self.feed(source)
    def handle_starttag(self, tag, attrs):
        a=dict(attrs)
        if tag=='a' and a.get('href'): self.anchor=[a['href'],'']
        if tag=='script' and a.get('type')=='application/ld+json': self.script=''
    def handle_data(self, data):
        if self.anchor is not None: self.anchor[1]+=data+' '
        if self.script is not None: self.script+=data
    def handle_endtag(self, tag):
        if tag=='a' and self.anchor is not None: self.links.append(self.anchor);self.anchor=None
        if tag=='script' and self.script is not None:
            try: self.schemas.append(json.loads(self.script))
            except ValueError: pass
            self.script=None


def walk(value, kind):
    if isinstance(value,dict):
        if value.get('@type')==kind: yield value
        for v in value.values(): yield from walk(v,kind)
    elif isinstance(value,list):
        for v in value: yield from walk(v,kind)


class Client:
    def __init__(self, refresh=False): self.refresh=refresh
    def get(self,url):
        if urlsplit(url).scheme not in ('https','http'): raise ValueError('Not an HTTP URL')
        directory=DATA/'discovery-cache';directory.mkdir(parents=True,exist_ok=True)
        path=directory/(hashlib.sha256(url.encode()).hexdigest()+'.json')
        if not self.refresh and path.exists() and time.time()-path.stat().st_mtime<21600:
            return json.loads(path.read_text())
        time.sleep(.35)
        with urlopen(Request(url,headers={'User-Agent':'JobPilotto/0.1 (personal job discovery)'}),timeout=15) as r:
            data={'url':r.url,'html':r.read(5_000_000).decode('utf-8',errors='replace')}
        path.write_text(json.dumps(data));return data


def parse_jobs(source, source_url, label):
    result=[]
    for j in walk(Page(source).schemas,'JobPosting'):
        if not ROLE.search(j.get('title','')): continue
        places=j.get('jobLocation',[]);places=places if isinstance(places,list) else [places]
        swiss=[]
        for place in places:
            address=place.get('address',{})
            country=address.get('addressCountry','')
            if isinstance(country,dict): country=country.get('name','')
            if str(country).lower() in ('ch','switzerland','schweiz','suisse'):
                swiss.append(address.get('addressLocality','Switzerland'))
        if not swiss: continue
        expiry=j.get('validThrough')
        if expiry and str(expiry)[:10] < datetime.now(timezone.utc).date().isoformat(): continue
        org=j.get('hiringOrganization',{})
        result.append({'company':org.get('name','Unknown employer'), 'profile':org.get('sameAs',''),
            'website':org.get('url',''), 'title':j['title'],'location':', '.join(swiss),
            'city':city(', '.join(swiss)), 'work_mode':mode(j['title']+' '+str(j.get('jobLocationType',''))),
            'url':urljoin(source_url,j.get('url',source_url)), 'source':label,
            'date_posted':j.get('datePosted',''), 'evidence':'Listed on job board; employer vacancy not independently confirmed'})
    return result


def parse_swissdevjobs(listing, wanted=None):
    """SwissDevJobs' public JSON list (/api/jobsLight), one dict per open job: the same job shape as parse_jobs.
    The list has no description, so one is written from its structured fields (level, technologies, language, visa, salary):
    facts the board states, nothing invented. `wanted(title)` picks the roles to keep (default: the board-discovery keywords; the
    crawl passes the search's own role keywords, so a "backend" job is not read and scored for an SRE search)."""
    wanted=wanted or (lambda title:bool(ROLE.search(title)))
    result=[]
    for j in listing if isinstance(listing,list) else []:
        if not isinstance(j,dict) or j.get('isPaused') or not j.get('jobUrl') or not wanted(j.get('name') or ''): continue
        place=text(j.get('actualCity') or j.get('cityCategory') or '') or 'Switzerland'
        facts=[('Level',j.get('expLevel')),('Type',j.get('jobType')),('Workplace',j.get('workplace')),('Technologies',', '.join(j.get('technologies') or [])),
               ('Working language',j.get('language')),('Visa sponsorship',j.get('hasVisaSponsorship')),('Company type',j.get('companyType')),('Company size',j.get('companySize'))]
        low,high=j.get('annualSalaryFrom'),j.get('annualSalaryTo')
        if low or high: facts.append(('Annual salary (CHF)',f'{low or "?"} to {high or "?"}'))
        description='\n'.join(f'{label}: {value}' for label,value in facts if value)
        website=j.get('companyWebsiteLink') or ''
        result.append({'company':j.get('company') or 'Unknown employer','profile':'','website':f'https://{website}' if website and '//' not in website else website,
            'title':j['name'],'location':f'{place}, Switzerland','city':city(place),'work_mode':mode(f"{j.get('workplace') or ''} {j['name']}"),
            'url':f"https://swissdevjobs.ch/jobs/{j['jobUrl']}",'source':'SwissDevJobs','date_posted':str(j.get('activeFrom') or '')[:10],
            'description':description,'salary':{'currency':'CHF','min':low,'max':high} if low or high else None,
            'evidence':'Listed on SwissDevJobs; employer vacancy not independently confirmed'})
    return result


def parse_tree(source):
    jobs=[]
    for url, block in re.findall(r'<a[^>]+href="(/job/[^"]+)"[^>]*>(.*?)</a>',source,re.S):
        title=re.search(r'<h3[^>]*>(.*?)</h3>',block,re.S)
        company=re.search(r'<p[^>]*>(.*?)</p>',block,re.S)
        loc=re.search(r'<span[^>]+class="[^"]*truncate text-foreground[^"]*"[^>]*>(.*?)</span>',block,re.S)
        if not(title and company and loc):continue
        title,company,loc=map(lambda x:text(x[1]),(title,company,loc))
        swiss_hint = re.search(r'switzerland|schweiz|suisse',loc,re.I) or any(
            re.search(r'(?<!\w)'+re.escape(a)+r'(?!\w)',loc,re.I)
            for aliases in CITIES.values() for a in aliases)
        if not ROLE.search(title) or not swiss_hint: continue
        jobs.append({'company':company,'profile':'','website':'','title':title,'location':loc,'city':city(loc),
            'work_mode':mode(loc),'url':urljoin('https://jobs.techtree.dev',url),'source':'TechTree',
            'date_posted':'','evidence':'Swiss city on board; employer identity may be undisclosed'})
    return jobs


def platform(url):
    host=(urlsplit(url).hostname or '').lower()
    return next((name for domain,name in ATS.items() if host==domain or host.endswith('.'+domain)),'Company website / unknown ATS')


def useful_links(page,base):
    found=[]
    for href,label in Page(page).links:
        url=urljoin(base,href)
        if urlsplit(url).scheme not in ('http','https') or any(
            domain in urlsplit(url).netloc for domain in ('linkedin.com','xing.com','slideshare.net','facebook.com','instagram.com','youtube.com')):continue
        if CAREER.search(label+' '+url) or platform(url)!='Company website / unknown ATS':
            if url not in found:found.append(url)
    return sorted(found, key=lambda u: (bool(urlsplit(u).fragment), len(urlsplit(u).path)))


def enrich(pair,client):
    name,jobs=pair
    c={'company':name,'jobs':jobs,'website':'','size':'Unknown','min_employees':None,'career_pages':[], 'platforms':[], 'notes':[]}
    for job in jobs:
        if job['source'] != 'jobs.ch': continue
        try:
            detail=client.get(job['url'])
            posting=next(walk(Page(detail['html']).schemas,'JobPosting'),{})
            description=text(posting.get('description',''))
            job['work_mode']=mode(job['title']+' '+str(posting.get('jobLocationType',''))+' '+description)
            job['description']=description[:12000]
        except Exception as e:
            c['notes'].append(f'Job detail unavailable; remote conditions unverified: {type(e).__name__}')
    try:
        profile=jobs[0]['profile']
        if profile and urlsplit(profile).hostname=='www.jobs.ch':
            p=client.get(profile)
            org=next((o for o in walk(Page(p['html']).schemas,'Organization') if o.get('url') and o.get('name')==name),{})
            c['website']=org.get('url','')
            n=org.get('numberOfEmployees',{})
            if isinstance(n,dict) and n.get('minValue') is not None:
                c['min_employees']=n['minValue'];c['size']=f"{n['minValue']}–{n.get('maxValue','+')} (board profile)"
        if not c['website']:c['website']=jobs[0].get('website','')
        if not c['website']:
            c['notes'].append('Official website unresolved; no domain guessed');return c
        if any(d in urlsplit(c['website']).netloc for d in ('jobs.ch','linkedin.com','swissdevjobs.ch')):
            c['notes'].append('Only a board profile found');c['website']='';return c
        home=client.get(c['website']); c['website']=home['url']
        candidates=useful_links(home['html'],home['url'])[:3]
        for url in candidates:
            try:
                p=client.get(url)
                c['career_pages'].append(p['url'])
                for link in [p['url']]+useful_links(p['html'],p['url']):
                    name_ats=platform(link)
                    if name_ats!='Company website / unknown ATS' and {'platform':name_ats,'url':link} not in c['platforms']:
                        c['platforms'].append({'platform':name_ats,'url':link})
            except Exception as e:c['notes'].append(f'Career link unavailable: {url}: {type(e).__name__}')
        if not candidates:c['notes'].append('No career link found on homepage')
    except Exception as e:c['notes'].append(f'Enrichment incomplete: {type(e).__name__}: {e}')
    return c


def render(report):
    cards=[]
    for c in report['companies']:
        locations=sorted({j['city'] for j in c['jobs']});modes=sorted({j['work_mode'] for j in c['jobs']})
        links=([('Website',c['website'])] if c['website'] else [])+[(f'Careers {i+1}',u) for i,u in enumerate(c['career_pages'])]+[(a['platform'],a['url']) for a in c['platforms']]
        linkhtml=' · '.join(f'<a href="{escape(u,quote=True)}" target="_blank" rel="noopener">{escape(label)}</a>' for label,u in links)
        jobhtml=''.join(f'<li><a href="{escape(j["url"],quote=True)}">{escape(j["title"])}</a> — {escape(j["location"])} · {escape(j["work_mode"])} · {escape(j["source"])}</li>' for j in c['jobs'])
        hay=' '.join([c['company']]+locations+modes+[j['title'] for j in c['jobs']])
        cards.append(f'<article data-search="{escape(hay.lower(),quote=True)}"><h2>{escape(c["company"])}</h2><p>{escape(", ".join(locations))} · Size: {escape(c["size"])}</p><p>{linkhtml}</p><ul>{jobhtml}</ul><small>{escape("; ".join(c["notes"]))}</small></article>')
    status=''.join(f'<li>{escape(s["source"])}: {escape(s["status"])}</li>' for s in report['sources'])
    return '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Swiss software employers</title><style>body{font:16px system-ui;max-width:1000px;margin:32px auto;padding:0 20px;background:#f4f6fa;color:#182537}article{background:white;padding:20px;margin:16px 0;border:1px solid #dbe1e8;border-radius:12px}a{color:#165bba}li{margin:10px 0}input{font:inherit;padding:12px;width:90%}small{color:#576579}button{padding:8px;margin:8px 4px} [hidden]{display:none}</style><h1>Swiss software employers</h1>'''+f'<p>{len(cards)} companies · Checked {escape(report["checked_at"])}</p><p>Board-listed vacancies; official job availability is not independently confirmed. City refers to the job, not headquarters. Remote eligibility must be checked. Company size is retained when published; unknown sizes are included. No applicant-count or competition claims.</p><input id="q" aria-label="Filter companies" placeholder="City, company, remote, SRE…"><div>'+''.join(f'<button type="button" data-value="{v}">{v or "All"}</button>' for v in ['', 'Zurich','Geneva','Lausanne','Remote','Hybrid','SRE'])+'</div><p id="count"></p>'+''.join(cards)+'<h2>Discovery coverage</h2><ul>'+status+'</ul><script>const q=document.querySelector("#q");function filter(){let n=0;document.querySelectorAll("article").forEach(a=>{a.hidden=!a.dataset.search.includes(q.value.toLowerCase());if(!a.hidden)n++});document.querySelector("#count").textContent=n+" companies shown"}q.addEventListener("input",filter);document.querySelectorAll("button").forEach(b=>b.onclick=()=>{q.value=b.dataset.value;filter()});filter()</script></html>'


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--pages',type=int,default=1);p.add_argument('--max-companies',type=int,default=30);p.add_argument('--refresh',action='store_true');args=p.parse_args()
    if not 1<=args.pages<=10 or not 1<=args.max_companies<=200:p.error('pages: 1–10; max-companies: 1–200')
    from ..features import disabled
    if disabled('discover'):
        print('jobs.ch/TechTree discovery is off (JOB_PILOTTO_DISABLE includes discover).');return 0
    if os.getenv('JOB_PILOTTO_FIXTURE_DIR'):   # the end-to-end journey (desktop/e2e): only its fixture feeds, no live crawl
        print('jobs.ch/TechTree discovery is off (fixture feeds only).');return 0
    if not swiss_places(_SEARCH):   # these boards list Swiss employers only: nothing to find for places elsewhere
        print('jobs.ch/TechTree discovery is skipped: those boards list Swiss employers only and your places are elsewhere.');return 0
    client=Client(args.refresh);jobs=[];sources=[]
    for query in _SEARCH['jobs_board_search_queries']:
        for page in range(1,args.pages+1):
            url='https://www.jobs.ch/en/vacancies/?'+urlencode({'term':query,'page':page})
            try:
                result=client.get(url);found=parse_jobs(result['html'],url,'jobs.ch');jobs.extend(found)
                sources.append({'source':url,'status':f'{len(found)} Swiss software matches' if found else 'No parsed Swiss software matches; page may be empty or format changed'})
            except Exception as e:sources.append({'source':url,'status':str(e)})
    for label,url in [('SwissDevJobs','https://swissdevjobs.ch/api/jobsLight'),('TechTree','https://jobs.techtree.dev/')]:
        try:
            page=client.get(url)['html']
            found=parse_tree(page) if label=='TechTree' else parse_swissdevjobs(json.loads(page),wanted_title);jobs.extend(found)
            sources.append({'source':label,'status':f'{len(found)} matching listings on fetched page' if found else 'No compatible listings parsed; requires another adapter'})
        except Exception as e:sources.append({'source':label,'status':f'Unavailable: {e}'})
    groups={};seen=set()
    for job in jobs:
        if job['url'] in seen:continue
        seen.add(job['url']);groups.setdefault(job['company'],[]).append(job)
    report={'checked_at':datetime.now(timezone.utc).isoformat(timespec='seconds'),'sources':sources,'discovered_companies':len(groups),'companies':[]}
    with ThreadPoolExecutor(max_workers=3) as pool:
        for company in pool.map(lambda pair:enrich(pair,client),list(groups.items())[:args.max_companies]):
            report['companies'].append(company);print('Checked:',company['company'],flush=True)
    report['companies'].sort(key=lambda c:(not bool(c['career_pages']),-(c['min_employees'] or 0),c['company']))
    out=REPORTS;out.mkdir(exist_ok=True)
    (out/'companies.html').write_text(render(report))
    (out/'companies.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    with (out/'companies.csv').open('w',newline='') as f:
        w=csv.writer(f);w.writerow(['company','size','cities','work_modes','website','career_pages','platforms','evidence_urls','notes'])
        for c in report['companies']:w.writerow([c['company'],c['size'],'; '.join(sorted({j['city'] for j in c['jobs']})),'; '.join(sorted({j['work_mode'] for j in c['jobs']})),c['website'],'; '.join(c['career_pages']),'; '.join(sorted({a['platform'] for a in c['platforms']})),'; '.join(j['url'] for j in c['jobs']),'; '.join(c['notes'])])
    print(json.dumps({'discovered':len(groups),'enriched':len(report['companies']),'career_pages_found':sum(bool(c['career_pages']) for c in report['companies']),'report':str(out/'companies.html'),'sources':sources},indent=2))

if __name__=='__main__':main()
