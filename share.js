// Versioned, self-contained route links. Decoded data still needs route validation.
export const MAX_ROUTE_BYTES=2_000_000;
export const MAX_LINK_PAYLOAD=120_000;
const PREFIX='#route=v1.';

async function readLimited(stream,limit){
  const reader=stream.getReader(),chunks=[];let size=0;
  try{
    for(;;){
      const {done,value}=await reader.read();if(done)break;
      size+=value.length;
      if(size>limit){await reader.cancel();throw Error('Shared route is too large. Use a JSON file instead.');}
      chunks.push(value);
    }
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return bytes;
}

export async function createShareURL(route,baseURL){
  const bytes=new TextEncoder().encode(JSON.stringify(route));
  if(bytes.length>MAX_ROUTE_BYTES)throw Error('Route is too large to share as a link. Save JSON instead.');
  if(typeof CompressionStream==='undefined')throw Error('This browser cannot create route links. Save JSON instead.');
  const compressed=await readLimited(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip')),MAX_LINK_PAYLOAD);
  let binary='';
  for(let i=0;i<compressed.length;i+=4096)binary+=String.fromCharCode(...compressed.subarray(i,i+4096));
  const payload=btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  if(payload.length>MAX_LINK_PAYLOAD)throw Error('Route is too large to share as a link. Save JSON instead.');
  const url=new URL(baseURL);url.search='';url.hash=PREFIX.slice(1)+payload;
  return url.href;
}

export async function readSharedRoute(hash){
  if(!hash.startsWith('#route='))return null;
  if(!hash.startsWith(PREFIX))throw Error('Unsupported shared-route version.');
  const payload=hash.slice(PREFIX.length);
  if(payload.length>MAX_LINK_PAYLOAD)throw Error('Shared route is too large. Use a JSON file instead.');
  if(!payload||!/^[A-Za-z0-9_-]+$/.test(payload)||payload.length%4===1)throw Error('Invalid route link. Copy the complete link and try again.');
  try{
    const binary=atob(payload.replace(/-/g,'+').replace(/_/g,'/'));
    const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
    const decoded=await readLimited(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),MAX_ROUTE_BYTES);
    const route=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decoded));
    if(route?.version!==1)throw Error('Unsupported route data.');
    return route;
  }catch(error){
    if(error.message.includes('too large'))throw error;
    throw Error('Invalid route link. Copy the complete link and try again.');
  }
}
