// Authored controls only. Native wait values are not whole-message seconds.
export const fields=['fixed_tags','fixed_units','explicit_wait_tags','explicit_wait_units',
  'skip_guard_tags','secondary_timer_units','speed_tags','instant_tags','unknown_controls'];

export function summarizeTiming(rows){
  const result=Object.fromEntries(fields.map(f=>[f,0]));result.missing=0;result.fastest_seconds=null;
  for(const [row,count] of rows){
    if(!row){result.missing+=count;continue;}
    if(row.length!==fields.length||row.some(n=>!Number.isFinite(n)||n<0))throw Error('Invalid timing profile.');
    fields.forEach((f,i)=>result[f]+=row[i]*count);
  }
  return result;
}

export function inspectTiming(tokens){
  const row=fields.map(()=>0),add=(key,n=1)=>row[fields.indexOf(key)]+=n;
  for(const t of tokens){
    if(t.kind!=='tag')continue;
    const raw=Uint8Array.from((t.payload||'').match(/../g)||[],v=>parseInt(v,16));
    if(t.group===5){
      if(t.tag>=0&&t.tag<3){add('fixed_tags');add('fixed_units',[15,30,60][t.tag]);}
      else add('unknown_controls');
    }else if(t.group===1){
      if([0,1,3].includes(t.tag)&&raw.length!==4){add('unknown_controls');continue;}
      const view=new DataView(raw.buffer);
      if(t.tag===0){add('explicit_wait_tags');add('explicit_wait_units',Math.max(0,view.getInt32(0,true)));}
      else if(t.tag===1){add('speed_tags');if(!Number.isFinite(view.getFloat32(0,true)))add('unknown_controls');}
      else if(t.tag===2)add('instant_tags');
      else if(t.tag===3){add('skip_guard_tags');add('secondary_timer_units',Math.max(0,view.getInt32(0,true)));}
      else if(t.tag!==4)add('unknown_controls');
    }
  }
  return summarizeTiming([[row,1]]);
}
