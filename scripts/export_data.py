"""Export the local text catalog as static browser data for GitHub Pages."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import sqlite3
from sequences import SequenceIndex


def export(source, dest):
    source=source.resolve();dest=dest.resolve();dest.mkdir(parents=True,exist_ok=True)
    data=dest/'data';data.mkdir(exist_ok=True)
    def write(name,obj):
        raw=json.dumps(obj,ensure_ascii=False,separators=(',',':')).encode('utf8')
        payload=gzip.compress(raw,compresslevel=9,mtime=0)
        path=data/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(payload)
        return dict(path='data/'+name,sha256=hashlib.sha256(payload).hexdigest(),bytes=len(payload))
    con=sqlite3.connect('file:'+(source/'build/route-text/messages.sqlite').as_posix()+'?mode=ro',uri=True)
    meta=json.loads(con.execute("select value from meta where key='catalog'").fetchone()[0])
    ids=[r[0] for r in con.execute("select id from messages where locale='USen' order by id")]
    positions={mid:i for i,mid in enumerate(ids)}
    records=[];metrics={};flag_names=[];chunksize=256
    for locale in meta['languages']:
        counts=[None]*len(ids);texts=['']*len(ids);details=[None]*len(ids)
        for mid,boxes,chars,flags,detail in con.execute('select id,boxes,chars,flags,detail from messages where locale=?',(locale,)):
            i=positions[mid];detail=json.loads(detail);flags=json.loads(flags)
            for f in flags:
                if f not in flag_names:flag_names.append(f)
            mask=sum(1<<flag_names.index(f) for f in flags)
            counts[i]=[boxes,chars,mask];texts[i]=detail['text'];details[i]=detail
        metrics[locale]=counts
        records.append(write(f'text-{locale}.json.gz',texts))
        for start in range(0,len(ids),chunksize):
            records.append(write(f'details/{locale}-{start//chunksize}.json.gz',details[start:start+chunksize]))
    refs={}
    for mid,flow,event,action,params,kind in con.execute('select distinct id,flow,event,action,params,kind from refs'):
        refs.setdefault(mid,[]).append(dict(flow=flow,event=event,action=action,params=params,kind=kind))
    con.close()
    index=SequenceIndex({d['name']:d for p in sorted((source/'build/decoded/package_1/EventFlow').glob('*.json'))
                         for d in [json.loads(p.read_text(encoding='utf8'))]})
    flows={}
    for name,d in index.flows.items():
        output={k:d[k] for k in ('name','source','source_sha256','entry_points') if k in d}
        if 'events' in d:
            output['events']=[]
            for e in d['events']:
                row={k:v for k,v in e.items() if k!='actor'}
                if e['type']=='ActionEvent' and e.get('action')!='EventTransition' and not any(k.startswith('MessageId') for k in e.get('params',{})):
                    row={k:e[k] for k in ('name','type','next') if k in e}
                output['events'].append(row)
        if 'timeline' in d:
            t=d['timeline'];output['timeline']={k:t[k] for k in ('subtimelines',) if k in t}
            for key in ('clips','oneshots'):
                output['timeline'][key]=[{k:e[k] for k in ('index','start_time','time','action','params') if k in e}
                                          for e in t[key] if any(k.startswith('MessageId') for k in e.get('params',{}))]
        flows[name]=output
    records.append(write('catalog.json.gz',dict(meta=meta,ids=ids,metrics=metrics,flags=flag_names,chunk_size=chunksize,refs=refs,sequences=index.catalog)))
    records.append(write('flows.json.gz',flows))
    manifest=dict(format=1,package=1,message_labels=len(ids),languages=len(metrics),files=records,
                  note='Generated from the user-supplied game. No executable, ROM, audio or image assets included.')
    (data/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf8')
    print(json.dumps(dict(files=len(records),compressed_bytes=sum(r['bytes'] for r in records),destination=str(dest))))


if __name__=='__main__':
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--source',type=Path,default=Path.cwd())
    ap.add_argument('--output',type=Path,required=True)
    args=ap.parse_args();export(args.source,args.output)
