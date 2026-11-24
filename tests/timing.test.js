import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {fields,inspectTiming,summarizeTiming} from '../timing.js';
import {compareCatalog} from '../backend.js';

const read=name=>JSON.parse(gunzipSync(readFileSync(new URL('../data/'+name,import.meta.url))));
const catalog=read('catalog.json.gz'),timing=read('timing.json.gz');
const tag=(group,tag,payload='')=>({kind:'tag',group,tag,payload});

test('waits, speed, instant reveal, and skip guards are different controls',()=>{
  const a=inspectTiming([tag(5,0),tag(5,1),tag(5,2),tag(1,0,'08000000'),
    tag(1,1,'0000003f'),tag(1,2),tag(1,3,'1e000000')]);
  assert.equal(a.fixed_tags,3);assert.equal(a.fixed_units,105);
  assert.equal(a.explicit_wait_units,8);assert.equal(a.secondary_timer_units,30);
  assert.equal(a.skip_guard_tags,1);assert.equal(a.instant_tags,1);assert.equal(a.speed_tags,1);
  assert.equal(a.fastest_seconds,null);
});

test('unknown controls and unavailable data cannot silently become zero-second timing',()=>{
  assert.equal(inspectTiming([tag(5,99),tag(1,0,'00'),tag(1,9)]).unknown_controls,3);
  const a=summarizeTiming([[null,3]]);assert.equal(a.missing,3);assert.equal(a.fastest_seconds,null);
  assert.equal(summarizeTiming([]).fastest_seconds,null);
  assert.equal(inspectTiming([tag(1,0,'ffffffff')]).explicit_wait_units,0);
});

test('timing index is pinned to the message ordering and covers all locales',()=>{
  assert.deepEqual(timing.fields,fields);
  assert.equal(timing.ids_sha256,createHash('sha256').update(catalog.ids.join('\n')).digest('hex'));
  for(const lang of Object.keys(catalog.meta.languages)){
    assert.equal(timing.metrics[lang].length,catalog.ids.length);
    assert(timing.metrics[lang].every(row=>row.length===fields.length));
  }
});

test('all exported timing rows agree with the independent browser token parser',()=>{
  for(const lang of Object.keys(catalog.meta.languages)){
    for(let chunk=0;chunk<Math.ceil(catalog.ids.length/catalog.chunk_size);chunk++){
      const details=read('details/'+lang+'-'+chunk+'.json.gz');
      details.forEach((d,j)=>{
        const i=chunk*catalog.chunk_size+j;
        if(i>=catalog.ids.length)return;
        assert.deepEqual(inspectTiming(d.tokens),summarizeTiming([[timing.metrics[lang][i],1]]),lang+' '+catalog.ids[i]);
      });
    }
  }
});

test('any% includes the forced shop-ledge greeting and no embedded skip guard',()=>{
  const route=JSON.parse(readFileSync(new URL('../routes/anypercent-1-0.json',import.meta.url)));
  const greeting=route.entries.filter(e=>e.sequence?.id==='Npc_Kokiri_011_Child::KokiriForest_Kokiri_011_StopInFrontOfShop_00');
  assert.deepEqual(greeting.map(e=>e.id.split(':')[1]),['Talk_02','Talk_08','Talk_07']);
  assert(greeting.every(e=>e.include&&e.notes===''));
  const r=compareCatalog(catalog,read('text-USen.json.gz'),route,timing);
  assert.equal(r.included,288);
  assert(r.scores.every(s=>s.timing.skip_guard_tags===0&&s.timing.missing===0));
  assert(r.scores.every(s=>s.timing.fastest_seconds===null));
  assert.equal(r.scores.find(s=>s.locale==='USen').boxes,369);
  const repeat=compareCatalog(catalog,[],{entries:[{...greeting[0],count:3},{id:'Missing',include:false}]},timing);
  const i=catalog.ids.indexOf(greeting[0].id);
  assert.equal(repeat.scores.find(s=>s.locale==='USen').timing.fixed_units,timing.metrics.USen[i][1]*3);
});
