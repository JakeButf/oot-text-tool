import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {normalize,compareCatalog} from '../backend.js';
import {expandSequence,searchSequences} from '../sequences.js';

const read=name=>JSON.parse(gunzipSync(readFileSync(new URL('../data/'+name,import.meta.url))));
const catalog=read('catalog.json.gz'),flows=read('flows.json.gz'),english=read('text-USen.json.gz');
test('published data matches manifest checksums',()=>{
  const manifest=JSON.parse(readFileSync(new URL('../data/manifest.json',import.meta.url)));
  for(const file of manifest.files){
    const data=readFileSync(new URL('../'+file.path,import.meta.url));
    assert.equal(data.length,file.bytes,file.path);
    assert.equal(createHash('sha256').update(data).digest('hex'),file.sha256,file.path);
  }
});
test('Saria intro follows calls in order and compares all 16 translations',()=>{
  const s=expandSequence(flows,catalog.sequences,'Dm_Kokiri_0060::EntryPoint0');
  assert.equal(s.complete,true);assert.deepEqual(s.parallel_groups,[]);
  assert.deepEqual(s.messages.map(m=>m.id.split('_').at(-1)),['0000','0001','0002','0003','0011','0004','0005','0006','0007','0008','0009','0010']);
  const result=compareCatalog(catalog,english,{entries:s.messages.map(m=>({id:m.id}))});
  assert.equal(result.scores.length,16);
  assert.equal(result.scores.find(s=>s.locale==='USen').boxes,14);
  assert.equal(result.scores.find(s=>s.locale==='EUde').boxes,13);
  assert(result.scores.every(s=>s.measured_seconds===null));
  assert(searchSequences(catalog.sequences,'saria intro cs').rows.some(s=>s.id==='Dm_Kokiri_0060::EntryPoint0'));
});
test('empty routes and missing messages cannot win',()=>{
  for(const entries of [[],[{id:'Missing:Unknown'}]])
    assert(compareCatalog(catalog,english,{entries}).scores.every(s=>s.boxes===null&&s.rank===null));
});
test('empty translations are unresolved, not a zero-box advantage',()=>{
  const c={ids:['X:A'],meta:{languages:{EN:'English',FR:'French'}},metrics:{EN:[[1,2,0]],FR:[[0,0,0]]},refs:{},flags:[]};
  const r=compareCatalog(c,['Hi'],{entries:[{id:'X:A'}]});
  assert.equal(r.scores.find(s=>s.locale==='FR').rank,null);
});
test('counts, exclusions, and measured time remain separate',()=>{
  const id=expandSequence(flows,catalog.sequences,'Dm_Kokiri_0060::EntryPoint0').messages[0].id;
  const r=compareCatalog(catalog,english,{entries:[{id,count:3},{id:'Missing:Unknown',include:false}],measurements:{[id]:{USen:2.5}}});
  assert.equal(r.scores.find(s=>s.locale==='USen').measured_seconds,7.5);
  assert.equal(r.scores.find(s=>s.locale==='EUde').measured_seconds,null);
  assert.equal(r.excluded,1);
});
test('route JSON preserves sequence groups and rejects invalid counts',()=>{
  const sequence={id:'F::Main',title:'Test',instance:'one',choices:{branch:'1'}};
  const route={name:'Route',entries:[{id:'Text:A',sequence}]};
  const saved=normalize(route);
  assert.deepEqual(normalize(JSON.parse(JSON.stringify(saved))),saved);
  assert.deepEqual(saved.entries[0].sequence,sequence);
  assert.throws(()=>normalize({entries:[{id:'Text:A',count:-1}]}));
});

test('unmatched subflow returns do not enter a lone success branch',()=>{
  const f={F:{entry_points:[{name:'Main',start:'call'},{name:'Check',start:'ret'}],events:[
    {name:'call',type:'SubFlowSwitchEvent',flowchart:'F',entry_point:'Check',cases:{'1':'talk'}},
    {name:'ret',type:'ReturnEvent',value:0},
    {name:'talk',type:'ActionEvent',action:'EventTalk',params:{MessageId:'X:Wrong'},next:null}
  ]}};
  const r=expandSequence(f,[{id:'F::Main',flow:'F',entry:'Main',title:'Test'}],'F::Main');
  assert.equal(r.complete,true);assert.deepEqual(r.messages,[]);
});

test('single-case queries require a choice and allow an unmatched result',()=>{
  const f={F:{entry_points:[{name:'Main',start:'check'}],events:[
    {name:'check',type:'SwitchEvent',query:'EventQueryIsGameDataBool',cases:{'0':'talk'}},
    {name:'talk',type:'ActionEvent',action:'EventTalk',params:{MessageId:'X:A'},next:null}
  ]}};
  const cat=[{id:'F::Main',flow:'F',entry:'Main',title:'Test'}];
  const r=expandSequence(f,cat,'F::Main');assert.equal(r.complete,false);assert.equal(r.messages.length,0);
  assert.equal(expandSequence(f,cat,'F::Main',{'F::Main/check':'otherwise'}).complete,true);
});

test('sheet route has no notes, includes one Forest inspection, and compares every language',()=>{
  const r=normalize(JSON.parse(readFileSync(new URL('../routes/anypercent-1-0.json',import.meta.url))));
  assert.equal(r.description,undefined);
  assert(r.entries.every(e=>e.notes===''));
  const inspections=r.entries.filter(e=>e.sequence.id.startsWith('Dm_InsideGanonCastle_0005::'));
  assert.equal(inspections.length,1);
  assert.equal(inspections[0].sequence.id,'Dm_InsideGanonCastle_0005::EntryPoint_Forest');
  assert.equal(inspections[0].include,true);
  assert.deepEqual(normalize(JSON.parse(JSON.stringify(r))),r);
  assert(!r.entries.some(e=>e.id.startsWith('EventFlowMsg/Dm_SY_Get:')));
  assert(r.entries.some(e=>e.sequence.title.includes('Chest-game start')));
  assert(r.entries.some(e=>e.sequence.title.includes('Potion-shop bottle')));
  const results=compareCatalog(catalog,english,r);
  assert.equal(results.scores.length,16);
  assert(results.scores.every(s=>s.boxes!==null&&s.measured_seconds===null));
  assert(r.entries.filter(e=>e.sequence.title.includes('Review:')).every(e=>!e.include));
  assert.throws(()=>normalize({...r,description:{}}));
});
test('unselected switches never combine alternative dialogue',()=>{
  const f={F:{entry_points:[{name:'Main',start:'switch'}],events:[
    {name:'switch',type:'SwitchEvent',query:'Flag',cases:{0:'a',1:'b'}},
    ...['a','b'].map(name=>({name,type:'ActionEvent',action:'EventTalk',params:{MessageId:'Text:'+name}}))
  ]}};
  const c=[{id:'F::Main',flow:'F',entry:'Main',title:'Test'}];
  const r=expandSequence(f,c,'F::Main');assert.equal(r.complete,false);assert.equal(r.messages.length,0);
  const selected=expandSequence(f,c,'F::Main',{[r.branches[0].key]:'1'});
  assert.equal(selected.complete,true);assert.equal(selected.messages[0].id,'Text:b');
});
if(process.env.PYTHON_SEQUENCE_RESULTS)test('static traversal agrees with independent Python traversal',()=>{
  const expected=JSON.parse(readFileSync(process.env.PYTHON_SEQUENCE_RESULTS));
  for(const result of expected){
    assert.deepEqual(expandSequence(flows,catalog.sequences,result.id,result.choices),result,result.id);
  }
});
