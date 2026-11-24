// Static data access. Requests stay on this site's origin; route files stay local.
import {expandSequence, searchSequences} from './sequences.js';
const pending=new Map();
async function compressed(name){
  if(!pending.has(name))pending.set(name,(async()=>{
    if(typeof DecompressionStream==='undefined')throw Error('This browser needs gzip DecompressionStream support.');
    const r=await fetch(new URL('./data/'+name,import.meta.url));
    if(!r.ok)throw Error('Could not load '+name+' ('+r.status+').');
    return JSON.parse(await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).text());
  })().catch(e=>{pending.delete(name);throw e}));
  // Keep the small shared indexes, but limit cached translation detail chunks.
  if(name.startsWith('details/')){
    const keys=[...pending.keys()].filter(k=>k.startsWith('details/'));
    while(keys.length>32)pending.delete(keys.shift());
  }
  return pending.get(name);
}
let catalogPromise;
async function catalog(){
  if(!catalogPromise)catalogPromise=compressed('catalog.json.gz').then(c=>{
    c.positions=new Map(c.ids.map((id,i)=>[id,i]));return c;
  }).catch(e=>{catalogPromise=null;throw e});
  return catalogPromise;
}

export function normalize(route){
  if(!route||typeof route!=='object'||!Array.isArray(route.entries))throw Error('A route needs an entries array.');
  if(route.entries.length>2000)throw Error('Maximum 2,000 route entries.');
  const entries=route.entries.map(e=>{
    if(!e||typeof e.id!=='string'||!e.id||e.id.length>500)throw Error('Invalid message ID.');
    const count=e.count??1,include=e.include??true,notes=e.notes??'';
    if(!Number.isInteger(count)||count<1||count>10000)throw Error('Counts must be integers from 1 to 10,000.');
    if(typeof include!=='boolean')throw Error('Include must be true or false.');
    if(typeof notes!=='string'||notes.length>2000)throw Error('Invalid notes.');
    const item={id:e.id,count,include,notes};
    if(e.sequence!==undefined){
      const s=e.sequence;
      if(!s||['id','title','instance'].some(k=>typeof s[k]!=='string'||s[k].length>500))throw Error('Invalid sequence group.');
      item.sequence={id:s.id,title:s.title,instance:s.instance};
      if(s.choices&&Object.keys(s.choices).length){
        if(Array.isArray(s.choices)||Object.keys(s.choices).length>500||Object.values(s.choices).some(v=>typeof v!=='string'))throw Error('Invalid saved sequence choices.');
        item.sequence.choices={...s.choices};
      }
    }
    return item;
  });
  const measurements=route.measurements??{};
  if(!measurements||typeof measurements!=='object'||Array.isArray(measurements))throw Error('Invalid measurements.');
  for(const values of Object.values(measurements)){
    if(!values||typeof values!=='object'||Array.isArray(values))throw Error('Invalid measurement.');
    for(const n of Object.values(values))if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>86400)throw Error('Invalid measured seconds.');
  }
  const name=route.name??'Untitled route';
  if(typeof name!=='string'||name.length>100)throw Error('Invalid route name.');
  return {version:1,name,entries,measurements};
}

export function compareCatalog(c,english,route){
  route=normalize(route);
  const positions=c.positions??new Map(c.ids.map((id,i)=>[id,i]));
  const active=route.entries.filter(e=>e.include);
  const scores=Object.entries(c.meta.languages).map(([locale,name])=>{
    let boxes=0,chars=0,seconds=0,unmeasured=0;const missing=[],warnings=new Set();
    for(const e of active){
      const row=c.metrics[locale][positions.get(e.id)];
      if(!row){missing.push(e.id);continue;}
      if(row[0]===0){missing.push(e.id+' (empty localized entry; fallback/display unresolved)');warnings.add('Empty localized message');continue;}
      boxes+=row[0]*e.count;chars+=row[1]*e.count;
      c.flags.forEach((f,i)=>{if(row[2]&(1<<i))warnings.add(f)});
      const measured=route.measurements[e.id]?.[locale];
      if(measured===undefined)unmeasured++;else seconds+=measured*e.count;
    }
    const complete=active.length>0&&missing.length===0;
    return {locale,name,boxes:complete?boxes:null,chars:complete?chars:null,missing,warnings:[...warnings].sort(),
            measured_seconds:complete&&!unmeasured?seconds:null,unmeasured};
  });
  const values=[...new Set(scores.map(s=>s.boxes).filter(v=>v!==null))].sort((a,b)=>a-b);
  for(const s of scores)s.rank=s.boxes===null?null:values.indexOf(s.boxes)+1;
  scores.sort((a,b)=>(a.boxes===null)-(b.boxes===null)||(a.boxes??0)-(b.boxes??0)||a.name.localeCompare(b.name));
  const entries=route.entries.map(e=>({...e,preview:english[positions.get(e.id)]??'',references:c.refs[e.id]??[],
    boxes:Object.fromEntries(Object.keys(c.meta.languages).map(lang=>[lang,c.metrics[lang][positions.get(e.id)]?.[0]??null]))}));
  return {scores,entries,included:active.length,excluded:route.entries.length-active.length};
}

async function saveFile(filename,route){
  if(!/^[A-Za-z0-9_-]{1,80}$/.test(filename))throw Error('Invalid filename.');
  const data=JSON.stringify(normalize(route),null,2)+'\n';
  const url=URL.createObjectURL(new Blob([data],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=filename+'.json';document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
  return {saved:filename+'.json'};
}

export async function api(path,body){
  const url=new URL(path,'https://local.invalid');
  if(url.pathname==='/api/routes')return [];
  if(url.pathname==='/api/save')return saveFile(body.filename,body.route);
  const c=await catalog();
  if(url.pathname==='/api/meta')return c.meta;
  if(url.pathname==='/api/compare')return compareCatalog(c,await compressed('text-USen.json.gz'),body);
  if(url.pathname==='/api/search'){
    const locale=url.searchParams.get('locale')||'USen';
    if(!Object.hasOwn(c.meta.languages,locale))throw Error('Unknown language.');
    const texts=await compressed('text-'+locale+'.json.gz'),q=(url.searchParams.get('q')||'').toLowerCase();
    const rows=[];
    c.ids.forEach((id,i)=>{if(id.toLowerCase().includes(q)||texts[i].toLowerCase().includes(q)||(c.refs[id]??[]).some(r=>r.flow.toLowerCase().includes(q))){
      rows.push({id,text:texts[i],boxes:c.metrics[locale][i][0],flags:[]});
    }});
    rows.sort((a,b)=>Number(!a.id.startsWith('EventFlowMsg/'))-Number(!b.id.startsWith('EventFlowMsg/'))||a.id.localeCompare(b.id));
    return {rows:rows.slice(0,80),more:rows.length>80};
  }
  if(url.pathname==='/api/message'){
    const id=url.searchParams.get('id'),i=c.positions.get(id),languages={};
    if(i!==undefined)await Promise.all(Object.keys(c.meta.languages).map(async lang=>{
      const chunk=await compressed('details/'+lang+'-'+Math.floor(i/c.chunk_size)+'.json.gz');
      if(chunk[i%c.chunk_size])languages[lang]=chunk[i%c.chunk_size];
    }));
    return {id,languages,references:c.refs[id]??[]};
  }
  if(url.pathname==='/api/sequences')return searchSequences(c.sequences,url.searchParams.get('q')||'');
  if(url.pathname==='/api/sequence'){
    const result=expandSequence(await compressed('flows.json.gz'),c.sequences,body.id,body.choices);
    const english=await compressed('text-USen.json.gz');
    for(const m of result.messages){const i=c.positions.get(m.id);m.preview=english[i]??'';m.boxes=c.metrics.USen[i]?.[0]??null;}
    return result;
  }
  throw Error('Unsupported operation.');
}
