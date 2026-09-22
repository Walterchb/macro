"""Official-source refresh. Python 3.12 standard library; never substitute invented data."""
import csv, io, json, math, os, re, hashlib, time, tempfile, sys
from pathlib import Path
from datetime import datetime, timezone, date
from urllib.request import Request, urlopen
from concurrent.futures import ThreadPoolExecutor, as_completed
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'dist/data'
MONTHS={'ene':1,'feb':2,'mar':3,'abr':4,'may':5,'jun':6,'jul':7,'ago':8,'sep':9,'set':9,'oct':10,'nov':11,'dic':12,'jan':1,'apr':4,'aug':8,'dec':12}

def parse_period(value):
    m=re.fullmatch(r'([A-Za-z]+)\.?([0-9]{4})',value)
    if m:return f'{m[2]}-{MONTHS[m[1].lower()]:02d}-01'
    m=re.fullmatch(r'(?:T|Q)?([1-4])(?:T|Q)?[.\-]([0-9]{2,4})',value)
    if m:
        y=int(m[2]);y+=2000 if len(m[2])==2 and y<70 else 1900 if len(m[2])==2 else 0
        return f'{y:04d}-{1+(int(m[1])-1)*3:02d}-01'
    raise ValueError('Formato de periodo no reconocido: '+value)

def request(url):
    for attempt in range(3):
        try:
            with urlopen(Request(url,headers={'User-Agent':'TreasuryMacroHub/1.0 (public economic research)'}),timeout=35) as response:
                return response.read().decode('utf-8-sig')
        except Exception:
            if attempt==2:raise
            time.sleep(1+attempt)

def numeric(v):
    try:
        n=float(v)
        return n if math.isfinite(n) else None
    except (TypeError,ValueError):return None

def fetch_bcrp(s,now):
    quarter=(now.month-1)//3+1
    end=f'{now.year}-{quarter if s["frequency"]=="quarterly" else now.month}'
    url=f'https://estadisticas.bcrp.gob.pe/estadisticas/series/api/{s["sourceCode"]}/json/2010-1/{end}'
    data=json.loads(request(url))
    configs=data.get('config',{}).get('series',[])
    if len(configs)!=1 or not data.get('periods'):raise ValueError('Respuesta BCRP vacía o esquema inesperado')
    rows=[]
    for p in data['periods']:
        v=numeric(p['values'][0])
        if v is not None:rows.append({'date':parse_period(p['name']),'value':v})
    if not rows:raise ValueError('BCRP sin observaciones numéricas')
    return [(s,rows,{'apiUrl':url,'description':configs[0]['name']})]

def fetch_fred(s,now):
    code=s['sourceCode'];url=f'https://fred.stlouisfed.org/graph/fredgraph.csv?id={code}&cosd=2010-01-01'
    text=request(url);reader=csv.DictReader(io.StringIO(text))
    if code not in (reader.fieldnames or []):raise ValueError('Esquema CSV FRED inesperado')
    rows=[]
    for r in reader:
        v=numeric(r.get(code));d=r.get('observation_date',r.get('DATE',''))
        if v is not None and d>='2010-01-01':rows.append({'date':d,'value':v})
    if not rows:raise ValueError('FRED sin observaciones numéricas')
    return [(s,rows,{'apiUrl':url})]

def fetch_wb(group,now):
    code=group[0]['sourceCode'];countries=';'.join(s['country'] for s in group)
    base=f'https://api.worldbank.org/v2/country/{countries}/indicator/{code}?format=json&date=2000:{now.year}&per_page=20000&source=2'
    data=json.loads(request(base))
    if not isinstance(data,list) or len(data)!=2 or not isinstance(data[0],dict):raise ValueError('Esquema Banco Mundial inesperado')
    all_rows=data[1] or []
    for page in range(2,int(data[0].get('pages',1))+1):
        nxt=json.loads(request(base+f'&page={page}'))
        if len(nxt)!=2:raise ValueError('Paginación Banco Mundial incompleta')
        all_rows.extend(nxt[1] or [])
    if not all_rows:raise ValueError('Respuesta Banco Mundial vacía para todo el indicador')
    result=[]
    for s in group:
        rows=[]
        for r in all_rows:
            if r['countryiso3code']==s['country'] and numeric(r.get('value')) is not None:
                rows.append({'date':r['date']+'-01-01','value':numeric(r['value'])})
        result.append((s,rows,{'apiUrl':base,'sourceUpdatedAt':data[0].get('lastupdated')}))
    return result

def validate_series(s):
    seen=set()
    for o in s['observations']:
        date.fromisoformat(o['date'])
        if o['date'] in seen:raise ValueError('Fecha duplicada: '+s['id'])
        if not isinstance(o['value'],(int,float)) or isinstance(o['value'],bool) or not math.isfinite(o['value']):raise ValueError('Valor no finito: '+s['id'])
        if o['date']>date.today().isoformat():raise ValueError('Observación futura: '+s['id'])
        seen.add(o['date'])
    if s['observations']!=sorted(s['observations'],key=lambda o:o['date']):raise ValueError('Serie desordenada')

def atomic_json(path,data):
    path.parent.mkdir(parents=True,exist_ok=True)
    fd,temp=tempfile.mkstemp(dir=path.parent,suffix='.tmp')
    try:
        with os.fdopen(fd,'w',encoding='utf-8') as f:json.dump(data,f,ensure_ascii=False,separators=(',',':'),allow_nan=False)
        os.replace(temp,path)
    finally:
        if os.path.exists(temp):os.unlink(temp)

def publish(snapshot):
    for s in snapshot['series']:validate_series(s)
    ids=[s['id'] for s in snapshot['series']]
    if len(ids)!=len(set(ids)):raise ValueError('IDs duplicados')
    snapshot['version']=hashlib.sha256(json.dumps(snapshot,sort_keys=True,ensure_ascii=False).encode()).hexdigest()[:16]
    atomic_json(OUT/'snapshot.json',snapshot)
    health={'version':snapshot['version'],'checkedAt':snapshot['fetchedAt'],'series':[{k:s.get(k) for k in ['id','name','provider','frequency','status','fetchedAt','lastObservationDate','error']}|{'observations':len(s['observations'])} for s in snapshot['series']]}
    atomic_json(OUT/'health.json',health)
    atomic_json(OUT/'manifest.json',{'version':snapshot['version'],'fetchedAt':snapshot['fetchedAt'],'file':'snapshot.json','series':len(ids),'observations':sum(len(s['observations']) for s in snapshot['series'])})

def main():
    now=datetime.now(timezone.utc);stamp=now.isoformat()
    catalog=json.loads((ROOT/'config/series.json').read_text())
    old=json.loads((OUT/'snapshot.json').read_text()) if (OUT/'snapshot.json').exists() else {'series':[]}
    previous={s['id']:s for s in old['series']};results={};errors=[];revisions=[]
    wb={}
    jobs=[]
    for s in catalog:
        if s['provider']=='World Bank':wb.setdefault(s['sourceCode'],[]).append(s)
        else:jobs.append((fetch_bcrp if s['provider']=='BCRP' else fetch_fred,[s],s))
    jobs.extend((fetch_wb,g,g) for g in wb.values())
    success=0
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures={pool.submit(fun,arg,now):group for fun,group,arg in jobs}
        for future in as_completed(futures):
            group=futures[future]
            try:
                fetched=future.result()
                batch_revisions=[]
                for s,rows,metadata in fetched:
                    rows.sort(key=lambda o:o['date']);prior=previous.get(s['id'])
                    if prior and prior['observations'] and (len(rows)<len(prior['observations'])*.8 or (rows and rows[-1]['date']<prior['observations'][-1]['date'])):
                        raise ValueError('Cobertura retrocedió; se conserva última versión válida')
                    updated={**s,**metadata,'observations':rows,'fetchedAt':stamp,'lastObservationDate':rows[-1]['date'] if rows else None,'status':'ok' if rows else 'no_data'}
                    validate_series(updated);results[s['id']]=updated
                    if prior:
                        lookup={o['date']:o['value'] for o in prior['observations']}
                        changed=[{'date':o['date'],'before':lookup[o['date']],'after':o['value']} for o in rows if o['date'] in lookup and abs(lookup[o['date']]-o['value'])>1e-10]
                        if changed:batch_revisions.append({'id':s['id'],'count':len(changed),'changes':changed})
                revisions.extend(batch_revisions)
                success+=1
            except Exception as error:
                # Group rollback: do not publish a partially validated country batch.
                for s in group:
                    prior=previous.get(s['id']);results[s['id']]={**(prior or s),'status':'retained' if prior and prior.get('observations') else 'unavailable','error':str(error),'lastAttemptAt':stamp,'observations':prior.get('observations',[]) if prior else []}
                errors.append({'provider':group[0]['provider'],'code':group[0]['sourceCode'],'error':str(error)})
                print('AVISO',group[0]['sourceCode'],str(error),flush=True)
    if success==0:raise RuntimeError('Todas las fuentes fallaron. No se altera la publicación.')
    snapshot={'schemaVersion':'1.0','fetchedAt':stamp,'series':[results[s['id']] for s in catalog],'errors':errors,'notes':old.get('notes',[])}
    if not any(s['observations'] for s in snapshot['series']):raise RuntimeError('Sin observaciones válidas')
    # Validate the snapshot before replacing the published file.
    for s in snapshot['series']:validate_series(s)
    publish(snapshot)
    atomic_json(OUT/'revisions.json',{'checkedAt':stamp,'revisions':revisions})
    summary=f'{len(catalog)} series; {len(errors)} solicitudes conservadas/fallidas; {len(revisions)} series revisadas.'
    print(summary)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'],'a') as f:f.write('## Sincronización macro\n\n'+summary+'\n')

if __name__=='__main__':
    try:main()
    except Exception as e:print('ERROR:',e,file=sys.stderr);sys.exit(1)
