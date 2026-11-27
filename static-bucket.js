// 瀏覽器版資料儲存：讀取 GitHub Pages 上由 Actions 發布的 data/，
// 寫入只留在本機（策略設定存在 localStorage，其餘留在記憶體）。
import { createBucket, indexFromJson, objectPath } from './bucket.js';

const LOCAL_KEY='taiwan-equity-lab-local-v1';
const persisted=new Set(['strategy']);
const storage={
  read(){try{return JSON.parse(localStorage.getItem(LOCAL_KEY)??'{}');}catch{return {};}},
  write(value){try{localStorage.setItem(LOCAL_KEY,JSON.stringify(value));}catch{}}
};
export async function openStaticBucket(base,fetcher=fetch) {
  const response=await fetcher(base+'index.json',{cache:'no-cache'});
  const saved=response.ok?await response.json():{};
  const index=indexFromJson(saved.objects);
  const local=new Map();
  for(const [key,{meta,text}] of Object.entries(storage.read())){
    if(!persisted.has(key)||!meta)continue;
    local.set(key,new TextEncoder().encode(text));
    index.set(key,meta);
  }
  const bucket=createBucket({
    index,
    async read(key,meta){
      if(local.has(key))return local.get(key);
      const r=await fetcher(base+objectPath(key)+'?v='+meta.etag);
      return r.ok?new Uint8Array(await r.arrayBuffer()):null;
    },
    async write(key,bytes,meta){
      local.set(key,bytes);
      if(!persisted.has(key))return;
      const all=storage.read();
      all[key]={meta,text:new TextDecoder().decode(bytes)};
      storage.write(all);
    }
  });
  bucket.updatedAt=saved.updatedAt??null;
  return bucket;
}
