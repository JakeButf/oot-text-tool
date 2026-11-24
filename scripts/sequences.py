"""Bounded structural traversal of decoded EventFlow, not a game-state simulator.

Follows entry points, calls, joins and explicit chosen switch cases. Fork arms
are concurrent; their listing order is not claimed to be runtime speech order.
Unknown dynamic arguments, loops and unexpanded transitions block Add sequence.
"""
import json
import re
from pathlib import Path
from functools import lru_cache

ROOT=Path(__file__).resolve().parents[2]
ALIASES={
 'Dm_Kokiri_0060':'Saria intro conversation: meeting Navi',
 'Dm_Kokiri_0050':'Saria first appearance: voiced cutscene',
 'Dm_Kokiri_0150':'Saria farewell: bridge cutscene',
 'Dm_MelodyGet_Saria':"Learning Saria’s Song",
}


class SequenceIndex:
    def __init__(self, flows=None):
        self.flows=flows if flows is not None else {
            d['name']:d for p in sorted((ROOT/'build/decoded/package_1/EventFlow').glob('*.json'))
            for d in [json.loads(p.read_text(encoding='utf8'))]}
        self.nodes={name:{e['name']:e for e in d.get('events',[])} for name,d in self.flows.items()}
        self.catalog=[]
        for name,d in self.flows.items():
            entries=[{'name':'@timeline'}] if 'timeline' in d else d.get('entry_points',[])
            actors=' '.join(a.get('identifier',{}).get('actor','') for a in d.get('actors',d.get('timeline',{}).get('actors',[])))
            for entry in entries:
                ep=entry['name'];title=ALIASES.get(name,name)
                if ep not in ('EntryPoint0','@timeline'):title+=' / '+ep
                self.catalog.append(dict(id=name+'::'+ep,flow=name,entry=ep,title=title,
                                         kind='timeline' if ep=='@timeline' else 'conversation',
                                         internal=bool(re.fullmatch(r'C\d+|[Rr]eady',ep)) and any(e['name']=='EntryPoint0' for e in entries),
                                         search=(title+' '+name+' '+ep+' '+actors+(' cutscene cs' if name in ALIASES else '')+(' introduction' if name in ('Dm_Kokiri_0050','Dm_Kokiri_0060') else '')).casefold()))

    def search(self,query):
        terms=query.casefold().split()
        rows=[{k:v for k,v in r.items() if k not in ('search','internal')} for r in self.catalog
              if all(t in r['search'] for t in terms) and (not r['internal'] or r['entry'].casefold() in terms)]
        rows.sort(key=lambda r:(not all(t in r['title'].casefold() for t in terms),r['flow'] not in ALIASES,r['entry'] not in ('EntryPoint0','@timeline'),r['title']))
        return dict(rows=rows[:80],more=len(rows)>80)

    def expand(self,sequence_id,choices=None):
        selected=next((r for r in self.catalog if r['id']==sequence_id),None)
        if not selected:raise ValueError('Unknown sequence.')
        choices=choices or {}
        if not isinstance(choices,dict) or len(choices)>500:raise ValueError('Invalid branch choices.')
        messages=[];issues=[];branches=[];sources={};parallel=set();steps=0
        def resolve(value,env):
            for _ in range(20):
                if not isinstance(value,dict) or set(value)!={'argument'}:return value
                name=value['argument']
                if name not in env:return value
                nxt=env[name]
                if nxt==value:return value
                value=nxt
            return value
        def issue(message,where):issues.append(dict(message=message,where=where))
        def add_message(e,flow,env,path,kind,lane='',time=None):
            action=e.get('action','')
            # Do not double-count a voice trigger as a second dialogue display.
            # Its wrapper-specific subtitle behavior has not been verified here.
            if action=='EventTriggerStartVoice':
                issue('Voice trigger needs subtitle-behavior review',path);return
            if any(k.startswith('MessageId') for k in e.get('params',{})) and not (
                    action.startswith('EventTalk') or action in ('EventPoeSpiritTalk','EventStartVoice','EventTriggerStartMessageVoice')):
                issue('Unclassified message action: '+action,path);return
            # Parameters on subflow calls pass arguments, they are not displays.
            for key,value in e.get('params',{}).items():
                if key!='MessageId' and not key.startswith('MessageId'):continue
                value=resolve(value,env)
                if value in ('',None):continue
                if not isinstance(value,str) or ':' not in value:
                    issue('Unresolved message argument: '+key,path);continue
                messages.append(dict(id=value,flow=flow,event=e.get('name',str(e.get('index',''))),
                                     action=action,kind=kind,lane=lane,time=time,occurrence=path+':'+key))
        def call(flow,entry,env,path,stack,lane=''):
            if len(stack)>40 or (flow,entry) in stack:
                issue('Recursive call or depth limit',path);return None
            d=self.flows.get(flow)
            if not d:issue('Missing event resource: '+flow,path);return None
            sources[flow]=dict(source=d.get('source'),sha256=d.get('source_sha256'))
            stack=stack+[(flow,entry)]
            if 'timeline' in d:
                t=d['timeline']
                for e in sorted(t.get('clips',[])+t.get('oneshots',[]),key=lambda e:(e.get('start_time',e.get('time',0)),e['index'])):
                    add_message(e,flow,env,path+'/'+str(e['index']),'timeline',lane,e.get('start_time',e.get('time')))
                for i,sub in enumerate(t.get('subtimelines',[])):
                    call(sub,'@timeline',env,path+'/timeline'+str(i),stack,lane)
                return None
            ep=next((x for x in d.get('entry_points',[]) if x['name']==entry),None)
            if not ep:issue('Missing entry point: '+flow+' / '+entry,path);return None
            local={k:v['value'] for k,v in ep.get('variables',{}).items()}
            local.update(env)
            return walk(flow,ep.get('start'),local,path,stack,None,lane)
        def choose(e,env,path,known=None):
            cases=e.get('cases',{})
            if known is not None and str(known) in cases:return cases[str(known)]
            if len(set(cases.values()))==1:return next(iter(cases.values()))
            value=choices.get(path)
            if isinstance(value,str) and value in cases:return cases[value]
            branches.append(dict(key=path,query=e.get('query',e.get('entry_point',e['type'])),
                                 params={k:resolve(v,env) for k,v in e.get('params',{}).items()},cases=cases))
            return None
        def walk(flow,node,env,path,stack,stop,lane):
            nonlocal steps
            visited=set()
            while node and node!=stop:
                steps+=1
                if steps>5000:issue('Traversal limit',path);return None
                if node in visited:issue('Loop; repeat count needs manual review',path+'/'+node);return None
                visited.add(node)
                e=self.nodes[flow].get(node);where=path+'/'+str(node)
                if not e:issue('Missing event node',where);return None
                kind=e['type']
                if kind=='ActionEvent':
                    add_message(e,flow,env,where,'flowchart',lane)
                    if e.get('action')=='EventTransition':
                        # Transition completion/replacement semantics are not recovered.
                        issue('EventTransition requires separate sequence: '+str(resolve(e.get('params',{}).get('EventName'),env)),where)
                    node=e.get('next')
                elif kind=='SwitchEvent':node=choose(e,env,where)
                elif kind in ('SubFlowEvent','SubFlowSwitchEvent'):
                    args={k:resolve(v,env) for k,v in e.get('params',{}).items()}
                    dest=e.get('flowchart') or flow
                    value=call(dest,e['entry_point'],args,where,stack,lane)
                    node=choose(e,env,where+'/return',value) if kind=='SubFlowSwitchEvent' else e.get('next')
                elif kind=='ForkEvent':
                    populated=0
                    for i,start in enumerate(e.get('forks',[])):
                        before=len(messages)
                        walk(flow,start,env,where+'/arm'+str(i),stack,e.get('join'),where+'/arm'+str(i))
                        populated+=len(messages)>before
                    if populated>1:parallel.add(where)
                    node=e.get('join')
                elif kind=='JoinEvent':node=e.get('next')
                elif kind=='ReturnEvent':return resolve(e.get('value'),env)
                else:issue('Unsupported node: '+kind,where);return None
            return None
        call(selected['flow'],selected['entry'],{},sequence_id,[])
        return dict(id=sequence_id,title=selected['title'],messages=messages,branches=branches,issues=issues,
                    complete=not branches and not issues,sources=sources,parallel_groups=sorted(parallel),
                    choices=choices,scope='Selected entry point and explicit subflow calls; not adjacent independently triggered events.')


@lru_cache(maxsize=1)
def index():return SequenceIndex()


if __name__=='__main__':
    import argparse
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('sequence');ap.add_argument('--choices',type=Path);ap.add_argument('--output',type=Path)
    args=ap.parse_args()
    choices=json.loads(args.choices.read_text(encoding='utf8')) if args.choices else {}
    result=index().expand(args.sequence,choices)
    encoded=json.dumps(result,indent=2,ensure_ascii=True)+'\n'
    if args.output:
        path=args.output.resolve()
        if not path.is_relative_to(ROOT):raise SystemExit('Output must stay in the project on G:.')
        path.write_text(encoded,encoding='utf8')
    else:print(encoded)
