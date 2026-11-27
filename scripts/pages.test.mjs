import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { shiftDate } from '../src/data.mjs';
import { acceptHistory } from '../src/history.mjs';
import { api } from '../src/server.mjs';
import { createBucket, objectPath } from '../src/bucket.mjs';
import { openStaticBucket } from '../src/static-bucket.mjs';
import { openFsBucket } from './fs-bucket.mjs';

function sample(length) {
  return Array.from({length},(_,i)=>{
    const close=100+i;
    return {date:shiftDate('2025-01-01',i),rows:[['L2330',close-.5,close+1,close-1,close,1200000,90000000,80000,20000,30000,30000,0,0,close-1,'公司']],
      coverage:{listedRows:700,otcRows:0,tw:900,ot:0,tc:1100,oc:0}};
  });
}
test('bucket conditional writes, metadata and paging follow R2 semantics',async()=>{
  const bucket=createBucket({index:new Map(),read:async()=>null,write:async()=>{}});
  const first=await bucket.put('a/1','x',{onlyIf:{etagDoesNotMatch:'*'},customMetadata:{n:'1'}});
  assert.ok(first.etag);
  assert.equal(await bucket.put('a/1','y',{onlyIf:{etagDoesNotMatch:'*'}}),null);
  assert.equal(await bucket.put('a/1','y',{onlyIf:{etagMatches:'other'}}),null);
  assert.ok(await bucket.put('a/1','y',{onlyIf:{etagMatches:first.etag}}));
  const racing=await Promise.all([1,2].map(()=>bucket.put('b','z',{onlyIf:{etagDoesNotMatch:'*'}})));
  assert.equal(racing.filter(Boolean).length,1);
  for(let i=2;i<6;i++)await bucket.put('a/'+i,'v');
  const page=await bucket.list({prefix:'a/',limit:3});
  assert.equal(page.objects.length,3);
  assert.ok(page.truncated);
  const rest=await bucket.list({prefix:'a/',cursor:page.cursor,limit:3});
  assert.deepEqual(rest.objects.map(o=>o.key),['a/4','a/5']);
  assert.equal(rest.truncated,false);
  assert.ok(await bucket.put('disclosure/L/2026-11-26','v'));
  await assert.rejects(bucket.put('../x','v'));
});
test('Actions store round-trips to disk and the browser reads the published files',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'pages-'));
  try {
    const store=await openFsBucket(dir);
    const days=sample(72);
    for(const [month,bars] of Map.groupBy(days,day=>day.date.slice(0,7))){
      assert.ok(await acceptHistory(store,month,gzipSync(JSON.stringify({days:bars})),'2026-01-01'));
    }
    await store.put('initial.gz',gzipSync(JSON.stringify({days})),{onlyIf:{etagDoesNotMatch:'*'}});
    await store.put('research',JSON.stringify({records:{L2330:{name:'公司'}},cash:{L2330:{ocf:1}}}));
    await store.save();

    const reopened=await openFsBucket(dir);
    assert.equal((await reopened.head('history/2025-02.gz')).customMetadata.first,'2025-02-01');
    const fileFetch=async url=>{
      const path=new URL(url).pathname.replace(/^\/data\//,'');
      try {return new Response(await readFile(join(dir,path)));}
      catch {return new Response(null,{status:404});}
    };
    const browser=await openStaticBucket('https://site.test/data/',fileFetch);
    for(const bucket of [reopened,browser]){
      const response=await api(new Request('https://lab.test/api/stock?id=L2330'),{BUCKET:bucket});
      assert.equal(response.status,200);
      const {indicators}=await response.json();
      assert.ok(Number.isFinite(indicators.ema20));
    }
    const settings=await api(new Request('https://lab.test/api/settings',{method:'POST',body:JSON.stringify({limit:3})}),{BUCKET:browser});
    assert.equal((await settings.json()).limit,3);
    assert.equal(await reopened.head('strategy'),null,'browser writes stay local');
    assert.ok(objectPath('day/2026-01-02').endsWith('.bin'));
  } finally {
    await rm(dir,{recursive:true,force:true});
  }
});
test('before the close, the Actions run still stores fundamentals so picks get a fundamentals score',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'research-'));
  try {
    const store=await openFsBucket(dir);
    const days=sample(72);
    for(const [month,bars] of Map.groupBy(days,day=>day.date.slice(0,7))){
      assert.ok(await acceptHistory(store,month,gzipSync(JSON.stringify({days:bars})),'2026-01-01'));
    }
    await store.put('initial.gz',gzipSync(JSON.stringify({days})),{onlyIf:{etagDoesNotMatch:'*'}});
    const released=new Date().toISOString().slice(0,10).replaceAll('-','');
    const codes=Array.from({length:120},(_,i)=>String(1101+i));
    const fetchSources=async()=>({failed:[],result:{
      tm:codes.map(c=>({'公司代號':c,'公司簡稱':'公司'+c,'產業別':'01','出表日期':released})),
      om:codes.map(c=>({SecuritiesCompanyCode:'2'+c.slice(1),CompanyAbbreviation:'櫃'+c,SecuritiesIndustryCode:'01',Date:released})),
      tr:codes.map(c=>({'公司代號':c,'出表日期':released,'資料年月':'11510','產業別':'水泥','營業收入-當月營收':'1000','營業收入-去年同月增減(%)':'12.5'})),
      or:codes.map(c=>({'公司代號':'2'+c.slice(1),'出表日期':released,'資料年月':'11510','產業別':'電子','營業收入-當月營收':'500','營業收入-去年同月增減(%)':'-3'})),
      tv:codes.map(c=>({Date:released,Code:c,PEratio:'12',PBratio:'1.5',DividendYield:'3'})),
      t_ci:codes.map(c=>({'公司代號':c,'出表日期':released,'年度':'115','季別':'3','基本每股盈餘（元）':'2.5','營業收入':'900','營業利益（損失）':'90'})),
      o_ci:codes.map(c=>({SecuritiesCompanyCode:'2'+c.slice(1),Date:released,Year:'115',Season:'3','基本每股盈餘（元）':'1.5'}))
    }});
    const call=()=>api(new Request('https://lab.test/api/fundamentals/refresh',{method:'POST',body:'{}'}),{BUCKET:store,fetchSources});
    const response=await call();
    assert.equal(response.status,200);
    const result=await response.json();
    assert.equal(result.state,'已更新基本面資料。');
    assert.equal(result.companies,240);
    assert.equal(result.revenue,240);
    assert.equal(result.eps,240);
    assert.equal(result.valuation,120);
    const saved=await store.get('research');
    assert.ok(saved);
    const research=await saved.json();
    assert.equal(research.records.L1101.yoy,12.5);
    assert.equal(research.records.L1101.eps,2.5);
  } finally {
    await rm(dir,{recursive:true,force:true});
  }
});
