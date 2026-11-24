import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {normalize} from '../backend.js';
import {createShareURL,readSharedRoute,MAX_ROUTE_BYTES,MAX_LINK_PAYLOAD} from '../share.js';

const base='https://jakebutf.github.io/oot-text-tool/?route=anypercent-1-0';
test('shared links preserve a full route and are independent snapshots',async()=>{
  const route=normalize({name:'Route 日本語 🎵',description:'Notes\nwith line breaks',entries:[
    {id:'Text:A',count:3,include:false,notes:'A choice & a # fragment',sequence:{id:'F::Main',title:'First conversation',instance:'one',choices:{'F::Main/Q':'otherwise'}}},
    {id:'Text:A',count:1,notes:'Repeated occurrence'}
  ],measurements:{'Text:A':{USen:2.75,JPja:1}}});
  const expected=structuredClone(route),link=await createShareURL(route,base);
  assert.equal(new URL(link).search,'');assert.match(new URL(link).hash,/^#route=v1\.[A-Za-z0-9_-]+$/);
  route.entries[0].count=9;route.measurements['Text:A'].USen=100;
  assert.deepEqual(normalize(await readSharedRoute(new URL(link).hash)),expected);
});

test('the complete sheet route fits in a link and restores every entry',async()=>{
  const route=normalize(JSON.parse(readFileSync(new URL('../routes/anypercent-1-0.json',import.meta.url))));
  const link=await createShareURL(route,base);
  assert(link.length<15_000);
  assert.deepEqual(normalize(await readSharedRoute(new URL(link).hash)),route);
});

test('ordinary anchors and empty routes work without a named-route dependency',async()=>{
  assert.equal(await readSharedRoute(''),null);assert.equal(await readSharedRoute('#help'),null);
  const route=normalize({entries:[]});
  assert.deepEqual(await readSharedRoute(new URL(await createShareURL(route,base)).hash),route);
});

test('bad, truncated, unsupported, and oversized links fail clearly',async()=>{
  const link=await createShareURL(normalize({entries:[]}),base),hash=new URL(link).hash;
  for(const invalid of ['#route=v2.abc','#route=v1.','#route=v1.!!!!','#route=v1.a',hash.slice(0,-8)])
    await assert.rejects(readSharedRoute(invalid),/Invalid|Unsupported/);
  await assert.rejects(readSharedRoute('#route=v1.'+'a'.repeat(MAX_LINK_PAYLOAD+1)),/too large/);
  const bomb=gzipSync(' '.repeat(MAX_ROUTE_BYTES+1)).toString('base64url');
  await assert.rejects(readSharedRoute('#route=v1.'+bomb),/too large/);
  await assert.rejects(createShareURL({version:1,name:'x'.repeat(MAX_ROUTE_BYTES),entries:[]},base),/too large/);
});

test('decoded candidates must pass the same schema checks as imported JSON',async()=>{
  const hash=new URL(await createShareURL({version:1,entries:[{id:'X:A',count:-1}]},base)).hash;
  assert.throws(()=>normalize({version:1,entries:[{id:'X:A',count:-1}]}));
  const candidate=await readSharedRoute(hash);
  assert.throws(()=>normalize(candidate),/Counts/);
});
