// Structural EventFlow traversal. Does not execute native game-state queries.
export function searchSequences(catalog,query){
  const terms=query.toLowerCase().split(/\s+/).filter(Boolean);
  const rows=catalog.filter(r=>terms.every(t=>r.search.includes(t))&&(!r.internal||terms.includes(r.entry.toLowerCase())))
    .map(({search,internal,...r})=>r);
  rows.sort((a,b)=>Number(!terms.every(t=>a.title.toLowerCase().includes(t)))-Number(!terms.every(t=>b.title.toLowerCase().includes(t)))
    ||Number(!['Dm_Kokiri_0060','Dm_Kokiri_0050','Dm_Kokiri_0150','Dm_MelodyGet_Saria'].includes(a.flow))-Number(!['Dm_Kokiri_0060','Dm_Kokiri_0050','Dm_Kokiri_0150','Dm_MelodyGet_Saria'].includes(b.flow))
    ||Number(!['EntryPoint0','@timeline'].includes(a.entry))-Number(!['EntryPoint0','@timeline'].includes(b.entry))||a.title.localeCompare(b.title));
  return {rows:rows.slice(0,80),more:rows.length>80};
}

export function expandSequence(flows,catalog,id,choices={}){
  const selected=catalog.find(r=>r.id===id);
  if(!selected)throw Error('Unknown sequence.');
  if(!choices||typeof choices!=='object'||Array.isArray(choices)||Object.keys(choices).length>500)throw Error('Invalid branch choices.');
  const messages=[],issues=[],branches=[],sources={},parallel=new Set(),nodes=new Map();let steps=0;
  const nodeMap=flow=>{if(!nodes.has(flow))nodes.set(flow,new Map((flows[flow]?.events??[]).map(e=>[e.name,e])));return nodes.get(flow)};
  function resolve(value,env){
    for(let i=0;i<20;i++){
      if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==1||!Object.hasOwn(value,'argument'))return value;
      if(!Object.hasOwn(env,value.argument))return value;
      const next=env[value.argument];if(JSON.stringify(next)===JSON.stringify(value))return value;value=next;
    }
    return value;
  }
  const issue=(message,where)=>issues.push({message,where});
  function addMessage(e,flow,env,path,kind,lane='',time=null){
    const action=e.action??'';
    if(action==='EventTriggerStartVoice'){issue('Voice trigger needs subtitle-behavior review',path);return;}
    if(Object.keys(e.params??{}).some(k=>k.startsWith('MessageId'))&&!(action.startsWith('EventTalk')||['EventPoeSpiritTalk','EventStartVoice','EventTriggerStartMessageVoice'].includes(action))){issue('Unclassified message action: '+action,path);return;}
    for(const [key,v] of Object.entries(e.params??{})){
      if(!key.startsWith('MessageId'))continue;
      const value=resolve(v,env);if(value===''||value===null||value===undefined)continue;
      if(typeof value!=='string'||!value.includes(':')){issue('Unresolved message argument: '+key,path);continue;}
      messages.push({id:value,flow,event:e.name??String(e.index??''),action,kind,lane,time,occurrence:path+':'+key});
    }
  }
  function call(flow,entry,env,path,stack,lane=''){
    if(stack.length>40||stack.some(([f,e])=>f===flow&&e===entry)){issue('Recursive call or depth limit',path);return null;}
    const d=Object.hasOwn(flows,flow)?flows[flow]:null;
    if(!d){issue('Missing event resource: '+flow,path);return null;}
    sources[flow]={source:d.source??null,sha256:d.source_sha256??null};stack=[...stack,[flow,entry]];
    if(d.timeline){
      const t=d.timeline,events=[...(t.clips??[]),...(t.oneshots??[])].sort((a,b)=>(a.start_time??a.time??0)-(b.start_time??b.time??0)||a.index-b.index);
      for(const e of events)addMessage(e,flow,env,path+'/'+e.index,'timeline',lane,e.start_time??e.time??null);
      (t.subtimelines??[]).forEach((sub,i)=>call(sub,'@timeline',env,path+'/timeline'+i,stack,lane));return null;
    }
    const ep=(d.entry_points??[]).find(e=>e.name===entry);
    if(!ep){issue('Missing entry point: '+flow+' / '+entry,path);return null;}
    const local=Object.fromEntries(Object.entries(ep.variables??{}).map(([k,v])=>[k,v.value]));
    return walk(flow,ep.start,{...local,...env},path,stack,null,lane);
  }
  function choose(e,env,path,known=null){
    const cases=e.cases??{};
    if(known!==null&&Object.hasOwn(cases,String(known)))return cases[String(known)];
    if(new Set(Object.values(cases)).size===1)return Object.values(cases)[0];
    const value=choices[path];if(typeof value==='string'&&Object.hasOwn(cases,value))return cases[value];
    branches.push({key:path,query:e.query??e.entry_point??e.type,params:Object.fromEntries(Object.entries(e.params??{}).map(([k,v])=>[k,resolve(v,env)])),cases});return null;
  }
  function walk(flow,node,env,path,stack,stop,lane){
    const visited=new Set();
    while(node&&node!==stop){
      if(++steps>5000){issue('Traversal limit',path);return null;}
      if(visited.has(node)){issue('Loop; repeat count needs manual review',path+'/'+node);return null;}visited.add(node);
      const e=nodeMap(flow).get(node),where=path+'/'+node;
      if(!e){issue('Missing event node',where);return null;}
      if(e.type==='ActionEvent'){
        addMessage(e,flow,env,where,'flowchart',lane);
        if(e.action==='EventTransition')issue('EventTransition requires separate sequence: '+String(resolve(e.params?.EventName,env)),where);
        node=e.next;
      }else if(e.type==='SwitchEvent')node=choose(e,env,where);
      else if(e.type==='SubFlowEvent'||e.type==='SubFlowSwitchEvent'){
        const args=Object.fromEntries(Object.entries(e.params??{}).map(([k,v])=>[k,resolve(v,env)]));
        const value=call(e.flowchart||flow,e.entry_point,args,where,stack,lane);
        node=e.type==='SubFlowSwitchEvent'?choose(e,env,where+'/return',value):e.next;
      }else if(e.type==='ForkEvent'){
        let populated=0;(e.forks??[]).forEach((start,i)=>{const before=messages.length;walk(flow,start,env,where+'/arm'+i,stack,e.join,where+'/arm'+i);if(messages.length>before)populated++});
        if(populated>1)parallel.add(where);node=e.join;
      }else if(e.type==='JoinEvent')node=e.next;
      else if(e.type==='ReturnEvent')return resolve(e.value,env);
      else{issue('Unsupported node: '+e.type,where);return null;}
    }
    return null;
  }
  call(selected.flow,selected.entry,{},id,[]);
  return {id,title:selected.title,messages,branches,issues,complete:branches.length===0&&issues.length===0,sources,
    parallel_groups:[...parallel].sort(),choices,scope:'Selected entry point and explicit subflow calls; not adjacent independently triggered events.'};
}
