"""Extract verified public historical release rows for recovery of exchange report gaps."""
import argparse
import hashlib
import json
from pathlib import Path
import re
from tempfile import TemporaryDirectory
import zipfile

import duckdb

PREFIX='data/taiwan/'
DAILY=re.compile(r'^daily/date=(\d{4}-\d{2}-\d{2})/part.parquet$')
FLOWS=re.compile(r'^institutional/date=(\d{4}-\d{2}-\d{2})/part.parquet$')
SYMBOL=re.compile(r'^([1-9]\d{3})\.(TWSE|TPEX)$')

def identifier(symbol):
    match=SYMBOL.fullmatch(symbol)
    if not match or match[1].startswith('91'):
        return None
    return ('L' if match[2]=='TWSE' else 'O')+match[1]

def valid_file(archive, name, file_map, base):
    payload=archive.read(PREFIX+name)
    metadata=file_map[name]
    if len(payload)!=metadata['size_bytes'] or hashlib.sha256(payload).hexdigest()!=metadata['sha256']:
        raise ValueError('Release member checksum mismatch: '+name)
    dest=Path(base)/name
    dest.parent.mkdir(parents=True,exist_ok=True)
    dest.write_bytes(payload)
    return str(dest)

def store(target,date,kind,value):
    (target/(date.replace('-','')+'-'+kind+'.json')).write_text(json.dumps(value,ensure_ascii=False,separators=(',',':')),encoding='utf8')

def extract(package,target,expected_hash):
    with package.open('rb') as f:
        if hashlib.file_digest(f,'sha256').hexdigest()!=expected_hash:
            raise ValueError('Release checksum mismatch')
    target.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(package) as archive, TemporaryDirectory(dir=target) as base:
        mf=json.loads(archive.read('manifest.json'))
        if mf['schema_version']!=1 or mf['contains_user_data'] is not False:
            raise ValueError('Unexpected release format')
        files={v['path']:v for v in mf['files']}
        db=duckdb.connect()
        master=valid_file(archive,'security_master.parquet',files,base)
        names={symbol:name for symbol,name in db.execute(
            "select symbol,name from read_parquet(?) where instrument_type='stock'",[master]).fetchall()}
        known_nonstocks={symbol for symbol, in db.execute(
            "select symbol from read_parquet(?) where instrument_type is not null and instrument_type<>'stock'",[master]).fetchall()}
        events_path=valid_file(archive,'adj_factor/events.parquet',files,base)
        events={}
        for symbol,date,reference in db.execute(
            "select symbol,effective_date,reference_price from read_parquet(?) where status='verified' order by effective_date",
            [events_path]).fetchall():
            sid=identifier(symbol)
            if sid:
                per_day=events.setdefault(date.isoformat(),{})
                if sid in per_day and per_day[sid]!=reference:
                    per_day[sid]=None
                elif sid not in per_day:
                    per_day[sid]=reference
        days=0
        for path in sorted(files):
            match=DAILY.fullmatch(path)
            flow=FLOWS.fullmatch(path)
            if not match and not flow:
                continue
            date=(match or flow)[1]
            file=valid_file(archive,path,files,base)
            if match:
                bars=db.execute("select symbol,open,high,low,close,volume,amount from read_parquet(?) where date=?",[file,date]).fetchall()
                rows=[]
                for symbol,o,h,l,c,v,a in bars:
                    sid=identifier(symbol)
                    if sid and symbol not in known_nonstocks and all(x is not None for x in (o,h,l,c,v,a)) and l>0 and v>0 and a>0 and l<=min(o,c) and h>=max(o,c):
                        action=events.get(date,{}).get(sid)
                        rows.append([sid,o,h,l,c,v,a,*([None]*5),int(sid in events.get(date,{})),action,names.get(symbol) or sid[1:],None,None])
                store(target,date,'release-quotes',rows)
                days+=1
            else:
                rows=db.execute("""select symbol,foreign_net,investment_trust_net,dealer_net,dealer_proprietary_net,dealer_hedge_net
                    from read_parquet(?) where date=? and trade_date=? and status='official' and not coalesce(has_discrepancy,false)""",
                    [file,date,date]).fetchall()
                store(target,date,'release-flows',[[identifier(r[0]),*r[1:]] for r in rows if identifier(r[0])])
            Path(file).unlink()
        for date,rows in events.items():
            store(target,date,'release-events',rows)
        print('Verified release',mf['seed_version'],days,'daily partitions')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('release',type=Path)
    parser.add_argument('output',type=Path)
    parser.add_argument('sha256')
    a=parser.parse_args()
    extract(a.release,a.output,a.sha256)
