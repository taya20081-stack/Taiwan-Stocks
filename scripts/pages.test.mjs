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
