import assert from 'node:assert/strict';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { asDate, companyDisclosures, compareIndustry, listedTradingDates, normalizeFundamentals, shiftDate, taipeiDate } from '../src/data.mjs';
import { acceptHistory, archiveList, historyCoverage, historySeries, streamStudy } from '../src/history.mjs';
import { config, indexes, study } from '../src/model.mjs';
import { api } from '../src/server.mjs';

function sample(length) {
  return Array.from({length},(_,i)=>{
    const close=100+i;
    return {date:shiftDate('2025-01-01',i),rows:[['L2330',close-.5,close+1,close-1,close,1200000,90000000,80000,20000,30000,30000,0,0,close-1,'公司']],
      coverage:{listedRows:700,otcRows:0,tw:900,ot:0,tc:1100,oc:0}};
  });
}
function bucketFixture() {
  const records=new Map();
  return {
    async head(key){return records.get(key)?.info??null;},
    async get(key){
      const row=records.get(key);
      return row?{...row.info,body:new Blob([row.bytes]).stream(),json:async()=>JSON.parse(row.bytes)}:null;
    },
    async put(key,bytes,{onlyIf,customMetadata}){
      const existing=records.get(key);
      if(onlyIf.etagDoesNotMatch==='*'&&existing || onlyIf.etagMatches&&existing?.info.etag!==onlyIf.etagMatches)return null;
      const info={key,etag:String((Number(existing?.info.etag)||0)+1),customMetadata};
      records.set(key,{bytes,info});
      return info;
    },
    async list({prefix}){return {objects:[...records.values()].map(x=>x.info).filter(o=>o.key.startsWith(prefix))};}
  };
}
test('peer comparison aligns periods and announcements retain only verified dates for the target',()=>{
  const target={industryCode:'24',industry:'半導體業',month:'2026-10',period:'2026Q3',valuationDate:'2026-11-26',revenue:100,yoy:20,eps:5,pe:25};
  const peers=compareIndustry({L2330:target,L2303:{...target,yoy:10,pe:15},O6488:{...target,month:'2026-09',yoy:90,pe:30},
    L2317:{...target,industryCode:'31'}},'L2330');
  assert.equal(peers.count,2);
  assert.deepEqual(peers.median.yoy,{value:10,n:1});
  assert.deepEqual(peers.median.pe,{value:22.5,n:2});
  const news={公司代號:'2330',發言日期:'1151126','主旨 ':'公告簽訂供應合約',說明:'公司已公告。'};
  const result=companyDisclosures([news,{...news,發言日期:'1151127'},{...news,公司代號:'2303'}],'L2330','2026-11-26');
  assert.equal(result.to,'2026-11-26');
  assert.equal(result.items.length,1);
  assert.equal(result.items[0].label,'訂單／合約');
  assert.equal(companyDisclosures(null,'L2330','2026-11-26').available,false);
});
test('public announcement archives merge repeat imports and exclude future filings',async()=>{
  const bucket=bucketFixture();
  const today=taipeiDate();
  const row={SecuritiesCompanyCode:'6488',發言日期:today,發言時間:'151000',主旨:'法人說明會'};
  const post=async rows=>{
    const request=new Request('https://lab.test/api/disclosures/import',{method:'POST',body:JSON.stringify({O:rows})});
    return (await api(request,{BUCKET:bucket})).json();
  };
  assert.deepEqual(await post([row,{...row,發言日期:shiftDate(today,1)}]),{O:{date:today,rows:1}});
  assert.deepEqual(await post([row,{...row,發言時間:'160000',主旨:'產能規劃'}]),{O:{date:today,rows:2}});
});
test('monthly imports are idempotent and reject coverage regressions or emerging-market symbols',async()=>{
  const bucket=bucketFixture();
  const days=sample(3);
  const bytes=x=>gzipSync(JSON.stringify({days:x}));
  assert.equal((await acceptHistory(bucket,'2025-01',bytes(days),'2026-01-01')).count,3);
  assert.equal((await acceptHistory(bucket,'2025-01',bytes(days),'2026-01-01')).count,3);
  assert.equal((await acceptHistory(bucket,'2025-01',bytes(days.slice(1)),'2026-01-01')).conflict,true);
  const bad=structuredClone(days);
  bad[0].rows[0][0]='E1234';
  assert.equal(await acceptHistory(bucket,'2025-01',bytes(bad),'2026-01-01'),null);
  const archives=await archiveList(bucket);
  assert.equal(historyCoverage(archives,days).listed,3);
});
test('individual indicators use verified corporate action prices from the archive',async()=>{
  const bucket=bucketFixture();
  const days=sample(72);
  const event=days[36].rows[0];
  event[12]=1;
  event[13]-=5;
  for(const [month,bars] of Map.groupBy(days,day=>day.date.slice(0,7))){
    await acceptHistory(bucket,month,gzipSync(JSON.stringify({days:bars})),'2026-01-01');
  }
  event[13]=null;
  await bucket.put('initial.gz',gzipSync(JSON.stringify({days})),{onlyIf:{etagDoesNotMatch:'*'}});
  const research={records:{L2330:{name:'公司'}},cash:{L2330:{ocf:1}}};
  await bucket.put('research',JSON.stringify(research),{onlyIf:{etagDoesNotMatch:'*'}});
  const response=await api(new Request('https://lab.test/api/stock?id=L2330'),{BUCKET:bucket});
  assert.equal(response.status,200);
  const {indicators}=await response.json();
  assert.ok(Number.isFinite(indicators.ema20)&&Number.isFinite(indicators.adx14));
  assert.equal(indicators.supertrendDirection,1);
});
test('month boundaries preserve the same prices, trades and results as a single in-memory series',async()=>{
  const bucket=bucketFixture();
  const all=sample(88);
  for(const [month,days] of Map.groupBy(all,d=>d.date.slice(0,7))) {
    await acceptHistory(bucket,month,gzipSync(JSON.stringify({days})),'2026-01-01');
  }
  const archives=await archiveList(bucket);
  const conf=config({score:0,horizon:10});
  const replay=await streamStudy(historySeries(bucket,archives,[],all.slice(-30)),{},conf);
  const monolithic=study(all,indexes(all),conf,{},{selections:true});
  assert.deepEqual(replay.history,monolithic.history);
  assert.deepEqual(replay.daily,monolithic.daily);
  const window={start:all[40].date,end:all[55].date,settleThroughEnd:true};
  const holdout=await streamStudy(historySeries(bucket,archives,[],[],window),{},conf,window);
  assert.ok(holdout.history.some(r=>r.status==='holding'));
  assert.ok(holdout.history.every(r=>r.date>=window.start&&r.date<=window.end&&(!r.exit||r.exit<=window.end)));
});
test('a gap between stored months cannot move an entry or exit to the next available quote',async()=>{
  const bucket=bucketFixture();
  const all=sample(25);
  const isolated=all.slice(-1).map(d=>({...d,date:'2025-04-02'}));
  const conf=config({score:0,horizon:5});
  const replay=await streamStudy(historySeries(bucket,[],[],[...all,...isolated]),{},conf);
  assert.ok(replay.history.some(r=>r.status==='calendar'));
  assert.ok(!replay.history.some(r=>r.date==='2025-04-02'));
});
test('dates and financial report visibility are validated against the published date',()=>{
  assert.equal(asDate('115/02/30'),null);
  assert.equal(asDate('113/02/29'),'2024-02-29');
  assert.deepEqual([...listedTradingDates({date:'20261101',stat:'OK',data:[['115/11/25']]},'2026-11-26')],['2026-11-25']);
  const profiles={tm:[{'公司代號':'2330','公司簡稱':'台積電'}],
    t_ci:[{'公司代號':'2330','年度':'115','季別':'3','出表日期':'1151127','基本每股盈餘（元）':'70'}]};
  const early=normalizeFundamentals(profiles,'2026-11-26');
  assert.equal(early.records.L2330.eps,undefined);
  const published=normalizeFundamentals(profiles,'2026-11-27');
  assert.equal(published.records.L2330.eps,70);
});

test('TDCC uses grade 15, ignores future rows and retains a real zero count',async()=>{
  const {tdccHolders}=await import('../src/data.mjs');
  const csv=['資料日期,證券代號,持股分級,人數,股數,占集保庫存數比例%',
    '20261120,2330  ,14,300,12345,1.5','20261120,2330  ,15,5,12345,1.5',
    '20261127,2330,15,30,12345,1.5','20261120,1234,15,0,0,0'].join('\r\n');
  const result=tdccHolders(csv,'2026-11-26');
  assert.deepEqual(result.get('2330'),{date:'2026-11-20',count:5});
  assert.deepEqual(result.get('1234'),{date:'2026-11-20',count:0});
});

test('chunked KD signals agree with the same contiguous 50-bar windows',async()=>{
  const all=sample(142);
  const conf=config({score:0,horizon:5,rules:[{field:'k9',op:'gte',value:0}]});
  const input=(async function*(){for(const day of all)yield {day};})();
  const replay=await streamStudy(input,{},conf);
  assert.deepEqual(replay.history,study(all,indexes(all),conf,{},{selections:true}).history);
  assert.equal(replay.history[0].date,all[49].date);
});
