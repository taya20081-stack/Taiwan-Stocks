// GitHub Actions 每日更新：直接執行 Worker API，資料存在 gh-pages 分支的 data/ 目錄。
// 用法：node scripts/pages-update.mjs DATA_DIR [--seed initial.gz] [--archives DIR] [--strategy FILE]
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { api } from '../src/server.mjs';
import { disclosureUrls } from '../src/data.mjs';
import { openFsBucket } from './fs-bucket.mjs';

const [dir,...rest]=process.argv.slice(2);
if(!dir)throw new Error('Usage: node scripts/pages-update.mjs DATA_DIR [--seed FILE] [--archives DIR] [--strategy FILE]');
const option=name=>{const i=rest.indexOf(name);return i>=0?rest[i+1]:null;};
const bucket=await openFsBucket(dir);
const env={BUCKET:bucket};
const call=async(path,init)=>{
  const response=await api(new Request('https://pages.invalid'+path,init),env);
  const body=await response.json().catch(()=>({}));
  console.log(init?.method??'GET',path,response.status,JSON.stringify(body).slice(0,400));
  return {status:response.status,body};
};
const post=(path,body,type='application/json')=>call(path,{method:'POST',headers:{'Content-Type':type},body});

const seed=option('--seed');
if(seed&&!await bucket.head('initial.gz'))await post('/api/initial',await readFile(seed),'application/gzip');
const archives=option('--archives');
if(archives){
  for(const name of (await readdir(archives)).filter(n=>/^\d{4}-\d{2}\.gz$/.test(n)).sort()){
    await post('/api/history/import?month='+name.slice(0,7),await readFile(join(archives,name)),'application/gzip');
  }
}
const strategy=option('--strategy');
if(strategy){
  const wanted=JSON.parse(await readFile(strategy,'utf8'));
  await post('/api/settings',JSON.stringify(wanted));
}
if(await bucket.head('initial.gz')){
  const feeds={};
  for(const [market,url] of Object.entries(disclosureUrls)){
    feeds[market]=await fetch(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(30000)})
      .then(r=>r.ok?r.json():null).catch(()=>null);
  }
  await post('/api/disclosures/import',JSON.stringify(feeds));
  // refresh 一次最多補 4 個交易日，連續呼叫直到沒有新資料。
  for(let i=0;i<8;i++){
    const {body}=await post('/api/refresh','{}');
    if(!body.updates?.length)break;
  }
  // 最新交易日若還沒有含基本面的完整資料（收盤前或來源延遲），先抓一份基本面供計分。
  await post('/api/fundamentals/refresh','{}');
  await call('/api/status');
}
await bucket.save();
