import test from 'node:test';
import assert from 'node:assert/strict';
import { trade, indexes, config, candidates, forecast, chipFlowDays, isEvent, lookbackFor, marketSignal, ruleGroups, study } from '../src/model.mjs';
import { priceIndicators, priceWindows } from '../src/indicators.mjs';

function day(i, price, reference=price-1, event=0) {
  return {date:'2026-01-'+String(i+1).padStart(2,'0'),rows:[['L2330',price-.5,price+1,price-1,price,1200000,90000000,80000,20000,30000,30000,0,event,reference,'測試公司']]};
}
const set=Array.from({length:25},(_,i)=>day(i,100+i));
test('expanded technical indicators work on day bars and honor missing data',()=>{
  const rows=Array.from({length:70},(_,i)=>day(i,100+i).rows[0]);
  const values=priceIndicators(rows,Object.keys(priceWindows),isEvent);
  assert.deepEqual(Object.keys(values).sort(),Object.keys(priceWindows).sort());
  assert.ok(Object.keys(priceWindows).every(key=>Object.hasOwn(ruleGroups.technical.fields,key)));
  assert.equal(values.ema20,159.5);
  assert.equal(values.adx14,100);
  assert.equal(values.plusDi14,50);
  assert.equal(values.minusDi14,0);
  assert.equal(values.supertrendDirection,1);
  assert.equal(values.mfi14,100);
  assert.equal(values.obv20,24000);
  assert.equal(values.cmf20,0);
  assert.equal(values.donchianHigh20,169);
  assert.equal(values.donchianLow20,148);
  assert.equal(values.donchianHighGap20,0);
  assert.equal(values.bollingerMiddle,159.5);
  assert.equal(values.awesomeOscillator,14.5);
  assert.ok(values.cci20>100&&values.volatility20>0);
  assert.deepEqual(priceIndicators(rows.slice(-49),['ema20','adx14'],isEvent),{});
  const unknown=rows.at(-1).slice();
  unknown[12]=1;
  unknown[13]=null;
  assert.deepEqual(priceIndicators([...rows.slice(0,-1),unknown],['atr14','cmf20'],isEvent),{});
});
test('a new volume indicator is applied to both selections and backtests',()=>{
  const pass=config({score:0,amount:0,rules:[{field:'mfi14',op:'gte',value:99}]});
  const fail=config({...pass,rules:[{field:'cmf20',op:'gt',value:1}]});
  const maps=indexes(set);
  assert.equal(lookbackFor(pass),20);
  assert.equal(candidates(set[20],20,maps,pass,null,false)[0].mfi14,100);
  assert.equal(study(set,maps,pass,{}, {selections:true}).history.length,5);
  assert.equal(study(set,maps,fail,{}, {selections:true}).history.length,0);
});
test('market signals require sustained public flows and a cost-adjusted forecast for buys',()=>{
  const rows=[1,1,-3,1,1].map(flow=>day(0,100).rows[0].map((n,i)=>i===7?flow:[8,10].includes(i)?0:n));
  assert.deepEqual(chipFlowDays(rows),{buyDays:4,sellDays:1});
  assert.deepEqual(chipFlowDays(rows.slice(1)),{});
  assert.equal(marketSignal({}), 'watch');
  const pick={tech:75,score:73,chipRatio:2,buyDays:4,sellDays:1};
  assert.equal(marketSignal(pick),'accumulation');
  assert.equal(marketSignal({...pick,chipRatio:-2,buyDays:2,sellDays:3}),'pressure');
  assert.equal(marketSignal({...pick,chipRatio:1.99}),'watch');
  const forecast={prob:60,upside:2,n:30,days:10};
  assert.equal(marketSignal({...pick,forecast}),'buy');
  assert.equal(marketSignal({...pick,forecast:{...forecast,days:9}}),'accumulation');
  assert.equal(marketSignal({...pick,forecast:{...forecast,upside:.2}}),'accumulation');
});
test('trade uses next opening price and the selected holding day with fees',()=>{
  const t=trade(set,indexes(set),20,'L2330',config({horizon:3,fee:0,tax:0,slip:0}));
  assert.equal(t.status,'done');
  assert.equal(t.entry,'2026-01-22');
  assert.equal(t.exit,'2026-01-24');
  assert.equal(t.open,120.5);
  assert.ok(Math.abs(t.net-100*(123/120.5-1))<1e-8);
  assert.ok(trade(set,indexes(set),20,'L2330',config({horizon:3})).net<t.net);
});
test('exclusion, holding, and absence remain distinct',()=>{
  const changed=set.slice();
  changed[22]=day(22,101,100,1);
  assert.equal(trade(changed,indexes(changed),20,'L2330',config({horizon:3})).status,'action');
  assert.equal(trade(set,indexes(set),23,'L2330',config({horizon:3})).status,'holding');
  assert.equal(trade(set,indexes(set),24,'L2330',config({horizon:3})).status,'waiting');
});
test('baseline screens custom price fields but requires date-specific fundamentals for fundamental rules',()=>{
  const charts=indexes(set);
  const priceRule=config({score:0,rules:[{field:'close',op:'gte',value:120}]});
  assert.equal(candidates(set[20],20,charts,priceRule,null,false).length,1);
  const epsRule=config({score:0,rules:[{field:'eps',op:'gt',value:0}]});
  assert.equal(candidates(set[20],20,charts,epsRule,null,false).length,0);
  assert.equal(candidates(set[20],20,charts,epsRule,{records:{L2330:{name:'測試公司',eps:1,yoy:10}}},true).length,1);
});
test('forecast excludes trades that only resolve on or after the signal date',()=>{
  const fake=Array.from({length:40},(_,i)=>({id:'L2330',score:70,gross:2,date:'day'+(i%10),exit:i<30?'2026-10-09':'2026-10-10'}));
  const p=forecast({id:'L2330',score:70},fake,'2026-10-10');
  assert.equal(p.n,30);
  assert.equal(p.prob,87.5);
  assert.equal(p.upside,2);
  assert.equal(forecast({id:'L2330',score:70},fake,'2026-10-09').prob,null);
});

test('rounds daily price limits towards the reference price using exchange ticks',async()=>{
  const {priceLimit}=await import('../src/model.mjs');
  assert.equal(priceLimit(40.6,true),44.65);
  assert.equal(priceLimit(40.6,false),36.55);
  assert.equal(priceLimit(9.99,true),10.95);
  assert.equal(priceLimit(1010,true),1110);
});

test('trades blocked at a low-priced limit remain unfilled',()=>{
  const low=day(20,.15,.15);
  const limit=day(21,.16,.15);
  low.rows[0].splice(1,4,.15,.15,.15,.15);
  limit.rows[0].splice(1,4,.16,.16,.16,.16);
  const series=[low,limit];
  assert.equal(trade(series,indexes(series),0,'L2330',config({horizon:1})).status,'unfilled');
  limit.rows[0].splice(1,4,.15,.15,.14,.15);
  assert.equal(trade(series,indexes(series),0,'L2330',config({horizon:1})).status,'done');
});

test('an unresolved exchange session interrupts settlement',()=>{
  const changed=set.slice();
  changed[22]={...changed[22],uncertain:true,rows:[]};
  assert.equal(trade(changed,indexes(changed),20,'L2330',config({horizon:3})).status,'calendar');
});

test('future-day snapshots cannot feed the full historical screen',async()=>{
  const {study}=await import('../src/model.mjs');
  const d=set[20].date;
  const c=config({score:0,rules:[{field:'eps',op:'gt',value:0}]});
  const frame={asOf:set[21].date,records:{L2330:{name:'測試公司',eps:1,yoy:10}}};
  assert.equal(study(set,indexes(set),c,{[d]:frame},{mode:'full',selections:true}).history.length,0);
  assert.equal(study(set,indexes(set),c,{[d]:{...frame,asOf:d}},{mode:'full',selections:true}).history.length,1);
});

test('KD computes 9-day RSV with K and D seeded at 50',async()=>{
  const {stochasticKD}=await import('../src/model.mjs');
  const rows=Array.from({length:9},()=>['L2330',10,11,9,11,10,100,null,null,null,null,null,0,null]);
  const result=stochasticKD(rows);
  assert.ok(Math.abs(result.k9-200/3)<1e-8);
  assert.ok(Math.abs(result.d9-500/9)<1e-8);
  assert.equal(stochasticKD(rows.slice(1)),null);
});

test('new rules use known date snapshots and report monthly revenue in millions',()=>{
  const chart=indexes(set),d=set[20];
  const conf=config({score:0,rules:[{field:'holders1000',op:'gte',value:60},{field:'revenue',op:'gte',value:1700}]});
  assert.equal(candidates(d,20,chart,conf,null,true).length,0);
  const data={asOf:d.date,records:{L2330:{revenue:1765000,holders1000:62,eps:2,yoy:8}}};
  const rows=candidates(d,20,chart,conf,data,true);
  assert.equal(rows[0].revenue,1765);
  assert.equal(rows[0].holders1000,62);
});

test('chip scoring ratio can be reconstructed from the saved flows and five matching activity bars',async()=>{
  const {chipFlowPercent}=await import('../src/model.mjs');
  const bars=Array.from({length:5},()=>[null,null,null,null,null,100000]);
  assert.equal(chipFlowPercent({foreign:50,trust:-10,active:10},bars),10);
  assert.equal(chipFlowPercent({foreign:0,trust:0,active:0},bars),0);
  assert.equal(chipFlowPercent({foreign:50,trust:null,active:10},bars),null);
  assert.equal(chipFlowPercent({foreign:50,trust:-10,active:10},bars.slice(1)),null);
});

test('chip score keeps ranking strong institutional flows instead of capping at one threshold',async()=>{
  const {chipScore}=await import('../src/model.mjs');
  assert.equal(chipScore(0),50);
  assert.equal(chipScore(null),null);
  assert.ok(Math.abs(chipScore(10)+chipScore(-10)-100)<1e-9);
  const scores=[8.6,29.7,46.2].map(chipScore);
  assert.ok(scores[0]<scores[1]&&scores[1]<scores[2]&&scores[2]<100);
  assert.ok(scores[0]>65&&scores[0]<75);
});
test('valuations published for an earlier close are rescaled to the quote date',async()=>{
  const {alignValuations}=await import('../src/data.mjs');
  const row=(id,close,event=0)=>[id,close,close,close,close,1000,1000,null,null,null,null,null,event,null,id];
  const days=[{date:'2026-11-25',rows:[row('L1477',223),row('L2597',193),row('L9999',50)]},
    {date:'2026-11-26',rows:[row('L1477',233),row('L2597',193),row('L9999',60,1)]}];
  const frame={asOf:'2026-11-26',records:{
    L1477:{pe:14.72,pb:4.13,yield:6.73,valuationDate:'2026-11-25'},
    L2597:{pe:16.33,pb:6.74,yield:5.01,valuationDate:'2026-11-26'},
    L9999:{pe:10,pb:1,yield:5,valuationDate:'2026-11-25'}}};
  alignValuations(frame,days);
  assert.equal(frame.records.L1477.valuationDate,'2026-11-26');
  assert.equal(frame.records.L1477.staleValuationDate,'2026-11-25');
  assert.ok(Math.abs(frame.records.L1477.pe-15.38)<0.01);
  assert.ok(Math.abs(frame.records.L1477.yield-6.44)<0.01);
  assert.equal(frame.records.L2597.pe,16.33);
  assert.equal(frame.records.L9999.pe,null);
});
