import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFundamentals, shiftDate } from '../src/data.mjs';
import { candidates, config, indexes, isEvent, lookbackFor, ruleGroups } from '../src/model.mjs';
import { flowIndicators, priceIndicators } from '../src/indicators.mjs';

const marketRow=(close,ref)=>['L2330',close,close+1,close-1,close,100000,50000000,10000,-2000,5000,2000,3000,0,ref,'台積電'];

test('whole-window price metrics are available as configurable rules and exclude insufficient data',()=>{
  const days=Array.from({length:70},(_,i)=>({
    date:shiftDate('2026-01-01',i),rows:[marketRow(100+i,99+i)]
  }));
  const settings=config({score:0,chip:0,rules:[
    {field:'rsi14',op:'gte',value:99},{field:'macd',op:'gt',value:0},{field:'ma60',op:'gte',value:130}
  ]});
  const maps=indexes(days);
  assert.equal(lookbackFor(settings),69);
  assert.equal(candidates(days[68],68,maps,settings,null,false).length,0);
  const [candidate]=candidates(days[69],69,maps,settings,null,false);
  assert.equal(candidate.rsi14,100);
  assert.equal(candidate.ma60,139.5);
  assert.ok(Math.abs(candidate.macd-7)<1e-9);
  const flat=Array.from({length:50},()=>marketRow(100,100));
  assert.equal(priceIndicators(flat,['rsi14'],isEvent).rsi14,50);
});

test('institutional totals, normalized turnover ratios and missing data respect the selected period',()=>{
  const rows=Array.from({length:20},()=>marketRow(100,100));
  assert.deepEqual(flowIndicators(rows,['foreign10','institution20','foreign5Pct']),{foreign10:100,institution20:260,foreign5Pct:10});
  rows[2][7]=null;
  assert.deepEqual(flowIndicators(rows,['foreign10','institution20','foreign5Pct']),{foreign10:100,foreign5Pct:10});
});

test('fundamental and TDCC rule fields preserve real units and can filter a saved snapshot',()=>{
  const date='2026-11-26';
  const tdcc=['資料日期,證券代號,持股分級,人數,股數,占集保庫存數比例%','20261120,2330,1,500,4000,0.5',
    ...[12,13,14,15].map(level=>'20261120,2330,'+level+',2,6000,5')].join('\n');
  const raw={tdcc,tm:[{'公司代號':'2330'}],
    tr:[{'公司代號':'2330','出表日期':'20261125','營業收入-當月營收':'700000','營業收入-上月比較增減(%)':'12','營業收入-去年同月增減(%)':'8'}],
    t_ci:[{'公司代號':'2330','出表日期':'20261125','年度':'115','季別':'3','基本每股盈餘（元）':'4','營業收入':'500000',
      '營業毛利（毛損）':'200000','營業利益（損失）':'100000','本期淨利（淨損）':'75000'}]};
  const frame=normalizeFundamentals(raw,date);
  const days=Array.from({length:21},(_,i)=>({date:shiftDate(date,i-20),rows:[marketRow(100,100)]}));
  const settings=config({score:0,chip:0,rules:[{field:'holders400',op:'eq',value:8},
    {field:'grossMargin',op:'eq',value:40},{field:'monthlyMoM',op:'eq',value:12}]});
  const [candidate]=candidates(days[20],20,indexes(days),settings,frame,true);
  assert.equal(candidate.holders400Pct,20);
  assert.equal(candidate.profit,75);
  assert.equal(candidate.netMargin,15);
  const fields=Object.values(ruleGroups).flatMap(g=>Object.keys(g.fields));
  assert.equal(new Set(fields).size,fields.length);
});
