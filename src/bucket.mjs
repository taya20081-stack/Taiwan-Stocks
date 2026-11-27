// R2 相容的資料儲存介面：GitHub Pages 版在瀏覽器與 GitHub Actions 中共用。
// index 是 Map(key → {etag,size,customMetadata})；read/write 由各環境提供。
const encoder=new TextEncoder();
export const objectPath=key=>'o/'+key+'.bin';
export const validKey=key=>/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(key)&&!key.includes('..');
const toBytes=async value=>{
  if(value==null)return new Uint8Array();
  if(typeof value==='string')return encoder.encode(value);
  if(value instanceof Uint8Array)return value;
  if(value instanceof ArrayBuffer)return new Uint8Array(value);
  if(ArrayBuffer.isView(value))return new Uint8Array(value.buffer,value.byteOffset,value.byteLength);
  if(typeof value.arrayBuffer==='function')return new Uint8Array(await value.arrayBuffer());
  return new Uint8Array(await new Response(value).arrayBuffer());
};
const head=(key,meta)=>({key,etag:meta.etag,httpEtag:'"'+meta.etag+'"',size:meta.size,customMetadata:{...(meta.customMetadata??{})}});
function body(key,meta,bytes) {
  return {...head(key,meta),
    get body(){return new Blob([bytes]).stream();},
    arrayBuffer:async()=>bytes.slice().buffer,
    text:async()=>new TextDecoder().decode(bytes),
    json:async()=>JSON.parse(new TextDecoder().decode(bytes))};
}
export function createBucket({index,read,write}) {
  const passes=(meta,onlyIf)=>{
    if(!onlyIf)return true;
    if(onlyIf.etagDoesNotMatch==='*'&&meta)return false;
    if(onlyIf.etagMatches!==undefined&&(!meta||meta.etag!==onlyIf.etagMatches))return false;
    return true;
  };
  const queue=new Map();
  return {
    async head(key){const meta=index.get(key);return meta?head(key,meta):null;},
    async get(key){
      const meta=index.get(key);
      if(!meta)return null;
      const bytes=await read(key,meta);
      return bytes?body(key,meta,bytes):null;
    },
    async put(key,value,options={}){
      if(!validKey(key))throw new Error('Invalid key: '+key);
      const bytes=await toBytes(value);
      // 依序處理同一 key 的寫入，讓條件式寫入與 R2 一樣具原子性。
      const previous=queue.get(key)??Promise.resolve();
      const task=previous.then(async()=>{
        if(!passes(index.get(key),options.onlyIf))return null;
        const meta={etag:crypto.randomUUID().replaceAll('-',''),size:bytes.byteLength,customMetadata:options.customMetadata??{}};
        await write(key,bytes,meta);
        index.set(key,meta);
        return head(key,meta);
      });
      queue.set(key,task.catch(()=>{}));
      return task;
    },
    async delete(keys){for(const key of [keys].flat())index.delete(key);},
    async list({prefix='',cursor,limit=1000}={}){
      const keys=[...index.keys()].filter(key=>key.startsWith(prefix)).sort();
      const start=cursor?Number(cursor):0;
      const page=keys.slice(start,start+limit);
      const next=start+page.length;
      return {objects:page.map(key=>head(key,index.get(key))),truncated:next<keys.length,
        ...(next<keys.length?{cursor:String(next)}:{}),delimitedPrefixes:[]};
    }
  };
}
export const indexToJson=index=>Object.fromEntries([...index.entries()].sort(([a],[b])=>a.localeCompare(b)));
export const indexFromJson=value=>new Map(Object.entries(value??{}));
