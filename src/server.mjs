import { alignValuations, asDate, cashFlow, companyDisclosures, compareIndustry, dailyUrls, disclosureUrls, fetchSources, finmindHistory, fundamentalUrls, jsonFetch, listedTradingDates, monthlyTradingUrl, normalizeDay, normalizeFundamentals, shiftDate, taipeiDate, tdccCsv } from './data.mjs';
import { VERSION, candidates, cashFields, chipFields, chipFlowDays, chipFlowPercent, chips, config, defaults, forecast, fundFields, indexes, isEvent, recommendationSignal, study, trade } from './model.mjs';
import { flowIndicators, priceIndicators, priceWindows } from './indicators.mjs';
import { acceptHistory, archiveList, historyCoverage, historySeries, streamStudy } from './history.mjs';
import { combineObservationTotals, observationTotals, observePick } from './observation.mjs';
import { renderHtmlSnapshot } from './snapshot.mjs';

const marketComplete = d => d && d.coverage.tc >= 650 && d.coverage.oc >= 550;
const valid = v => typeof v==='string' && v===asDate(v);
const detailIndicators=Object.keys(priceWindows);
const detailWindow=1+Math.max(...Object.values(priceWindows));
const json = (data, status = 200) => Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const endpointTools = [
  {name:'update_taiwan_equity_lab',description:'更新台股策略研究台的上市與上櫃行情、法人籌碼及財報，建立不可變更的當日選股紀錄。',inputSchema:{type:'object',properties:{},additionalProperties:false}},
  {name:'read_taiwan_equity_lab_status',description:'讀取最新交易日、已保存的推薦、資料更新及追蹤狀態。',inputSchema:{type:'object',properties:{},additionalProperties:false}}
];
async function get(bucket,key,fallback=null) {
  const v=await bucket.get(key);
  return v ? v.json() : fallback;
}
const put = (bucket,k,v,opts) => bucket.put(k,JSON.stringify(v),opts);
const create = (bucket,k,v) => put(bucket,k,v,{onlyIf:{etagDoesNotMatch:'*'}});
const disclosurePrefix=market=>'disclosure/'+market+'/';
async function allKeys(bucket, prefix) {
  const keys=[];
  let cursor;
  do {
    const page=await bucket.list({prefix,cursor,limit:500});
    keys.push(...page.objects.map(o=>o.key));
    cursor=page.truncated ? page.cursor : undefined;
  } while (cursor);
  return keys.sort();
}
async function limited(items, callback) {
  const results=[];
  for (let i=0;i<items.length;i+=6) results.push(...await Promise.all(items.slice(i,i+6).map(callback)));
  return results;
}
async function saveDisclosureFeeds(bucket,input,today) {
  const saved={};
  for(const market of ['L','O']){
    const feed=input?.[market];
    if(!Array.isArray(feed)||feed.length>500)continue;
    const rows=feed.filter(row=>{
      const date=asDate(row?.['發言日期']);
      const code=String(row?.['公司代號']??row?.SecuritiesCompanyCode??'');
      return date&&date<=today&&stockId(market+code)&&typeof (row['主旨']??row['主旨 '])==='string';
    });
    if(!rows.length)continue;
    const latest=rows.map(row=>asDate(row['發言日期'])).sort().at(-1);
    if(latest<shiftDate(today,-30))continue;
    const key=disclosurePrefix(market)+latest;
    const identity=row=>[row['公司代號']??row.SecuritiesCompanyCode,row['發言日期'],row['發言時間'],row['主旨']??row['主旨 ']].join('|');
    for(let attempt=0;attempt<3;attempt++){
      const snapshot=await bucket.get(key);
      const previous=snapshot?await snapshot.json():[];
      const merged=[...new Map([...previous,...rows].map(row=>[identity(row),row])).values()];
      const onlyIf=snapshot?{etagMatches:snapshot.etag}:{etagDoesNotMatch:'*'};
      if(await put(bucket,key,merged,{onlyIf})){
        saved[market]={date:latest,rows:merged.length};
        break;
      }
    }
  }
  return saved;
}
async function readCompanyDisclosures(bucket,id,today) {
  const prefix=disclosurePrefix(id[0]);
  const since=shiftDate(today,-30);
  const recent=async()=>{
    const keys=(await allKeys(bucket,prefix)).filter(key=>key.slice(prefix.length)>=since);
    return (await limited(keys,key=>get(bucket,key,[]))).flat();
  };
  const latest=fetch(disclosureUrls[id[0]],{headers:{Accept:'application/json'},signal:AbortSignal.timeout(6500)})
    .then(response=>response.ok?response.json():null).catch(()=>null);
  const [cached,live]=await Promise.all([recent().catch(()=>[]),latest]);
  const feed=Array.isArray(live)?[...cached,...live]:cached.length?cached:null;
  return companyDisclosures(feed,id,today);
}
async function archive(bucket) {
  const o=await bucket.get('initial.gz');
  if (!o) return {days:[],frames:{}};
  const body=o.body.pipeThrough(new DecompressionStream('gzip'));
  return new Response(body).json();
}
async function load(bucket) {
  const [old, keys]=await Promise.all([archive(bucket), allKeys(bucket,'day/')]);
  const retained=120;
  const archived=old.days.slice(-Math.max(1,retained-keys.length));
  const sorted=new Map((keys.length>=retained ? [] : archived).map(d=>[d.date,d]));
  const frames={};
  for(const pack of await limited(keys.slice(-retained), k=>get(bucket,k))) {
    if(!pack) continue;
    sorted.set(pack.day.date,pack.day);
    if (pack.frame) frames[pack.day.date]=pack.frame;
  }
  return {days:[...sorted.values()].sort((a,b)=>a.date.localeCompare(b.date)),frames};
}
async function* verifiedRecentDays(bucket,days,end) {
  const start=shiftDate(end,-120);
  const archives=await archiveList(bucket);
  for await(const {day} of historySeries(bucket,archives,[],days,{start,end,settleThroughEnd:true,warmupDays:0})){
    if(day.date>=start)yield day;
  }
}
async function priceRuleHistory(bucket,data,conf) {
  if(!data.days.length||!conf.rules.some(rule=>Object.hasOwn(priceWindows,rule.field)))return data;
  const end=data.days.at(-1).date;
  const repaired=[];
  for await(const day of verifiedRecentDays(bucket,data.days,end))repaired.push(day);
  return {...data,days:[...data.days.filter(day=>day.date<repaired[0]?.date),...repaired]};
}
function stockRecentBars(days,id) {
  const span=days.slice(-detailWindow);
  const gap=span.findLastIndex((day,i)=>day.gapBefore||(i>0&&day.date>shiftDate(span[i-1].date,7)));
  return span.slice(Math.max(0,gap)).map(day=>day.uncertain?null:day.rows.find(row=>row[0]===id));
}
const selectCurrent = (data, conf, freeze, previewFrame=null) => {
  const {days,frames}=data;
  const maps=indexes(days);
  const current=days.at(-1);
  if (!current) return {date:null,rows:[],count:0,frame:false,version:VERSION};
  const frame=frames[current.date] ?? previewFrame;
  const full=Boolean(frame);
  const rows=candidates(current,days.length-1,maps,conf,frame,full);
  const fit=study(days,maps,conf,frames,{mode:'full'}).fit;
  const baselineConfig=config({...conf,rules:conf.rules.filter(r=>!fundFields.has(r.field))});
  const baseline=study(days,maps,baselineConfig,frames).fit;
  const baseRanks=new Map(candidates(current,days.length-1,maps,{...baselineConfig,score:0,limit:current.rows.length},null,false).map(r=>[r.id,r.score]));
  const picks=rows.map(r=>{
    const fullResult=forecast(r,fit,current.date);
    if(full && fullResult.prob!==null) return {...r,forecast:{...fullResult,basis:'三面向'}};
    const p=forecast({...r,score:baseRanks.get(r.id) ?? -20},baseline,current.date);
    return {...r,forecast:{...p,basis:'價量＋籌碼基準'}};
  }).map(r=>({...r,bullish:r.forecast.prob>50&&r.forecast.upside>0,signal:recommendationSignal(r,conf)}));
  return {date:current.date,rows:picks,count:current.rows.length,coverage:current.coverage,
    frame:full, fundamentalsDate:frame?.asOf, cash:Object.keys(frame?.cash ?? {}).length, valuation:Object.values(frame?.records ?? {}).filter(r=>r.pe>0).length,
    config:conf, frozen:freeze, version:VERSION};
};
async function latestPicks(bucket,data,conf) {
  const date=data.days.at(-1)?.date;
  const saved=date&&await get(bucket,'recommendation/'+date);
  if(saved)return {...saved,rows:recommendationRows(saved,data.days,data.days.length-1)};
  const research=await get(bucket,'research');
  return selectCurrent(await priceRuleHistory(bucket,data,conf),conf,false,research);
}
async function addCash(data, day, frame, conf) {
  const maps=indexes(data.days);
  const scan=config({...conf,rules:conf.rules.filter(r=>!cashFields.has(r.field))});
  const primaries=candidates(day,data.days.length-1,maps,{...scan,limit:12},frame,true);
  const cash={};
  for (const row of primaries) {
    const existing = Object.values(data.frames).reverse().find(f=>f.cash?.[row.id] && f.records?.[row.id]?.period === frame.records[row.id]?.period);
    if (existing) cash[row.id]=existing.cash[row.id];
  }
  const missing=primaries.filter(p=>!cash[p.id]);
  for(const [id,result] of await limited(missing, async p=>{
    try {return [p.id,await cashFlow(p.id.slice(1), day.date)];} catch {return [p.id,null];}
  })) if(result) cash[id]=result;
  frame.cash=cash;
}
async function getFund(day, history, conf, provided) {
  const localTime=new Date();
  const date=day.date;
  if (date !== taipeiDate(localTime)) return null;
  const fetched=provided ?? await fetchSources(fundamentalUrls);
  if (!validFundamentals(fetched.result)) return null;
  if(!fetched.result.tdcc){
    fetched.result.tdcc=await tdccCsv().catch(()=>null);
    if(!fetched.result.tdcc)fetched.failed.push('tdcc');
  }
  const frame=alignValuations(normalizeFundamentals(fetched.result,date),history.days);
  frame.failures=fetched.failed;
  await addCash(history,day,frame,conf);
  return frame;
}
const validFundamentals=result=>['tm','om','tr','or','t_ci','o_ci'].every(k=>Array.isArray(result[k]) && result[k].length>100);
// 收盤前（或當日行情尚未齊全）沒有「當日完整資料」，基本面仍要先抓好，
// 讓最新一個交易日的推薦也能用最新財報、營收與估值計分。
async function refreshResearch(bucket,load_=fetchSources) {
  const today=taipeiDate();
  const [history,conf]=await Promise.all([load(bucket),get(bucket,'strategy',defaults)]);
  const latest=history.days.at(-1)?.date;
  if(!latest)return {state:'請先匯入歷史資料。'};
  if(history.frames[latest]?.asOf===latest)return {date:latest,state:'當日完整資料已含基本面。'};
  const fetched=await load_(fundamentalUrls);
  if(!validFundamentals(fetched.result))return {date:latest,state:'公司與財報資料來源暫時無法取得。',failed:fetched.failed};
  if(!fetched.result.tdcc){
    fetched.result.tdcc=await tdccCsv().catch(()=>null);
    if(!fetched.result.tdcc)fetched.failed.push('tdcc');
  }
  const research=normalizeFundamentals(fetched.result,today);
  research.failures=fetched.failed;
  await addCash(history,history.days.at(-1),research,conf);
  await put(bucket,'research',research);
  const records=Object.values(research.records);
  return {date:latest,asOf:today,state:'已更新基本面資料。',companies:records.length,
    revenue:records.filter(r=>Number.isFinite(r.yoy)).length,eps:records.filter(r=>Number.isFinite(r.eps)).length,
    valuation:records.filter(r=>r.pe>0).length,cash:Object.keys(research.cash??{}).length,failed:fetched.failed};
}
const weekday=date=>new Date(date+'T00:00:00Z').getUTCDay()%6!==0;
const trustedOrigin=request=>{
  const origin=request.headers.get('Origin');
  return !origin || origin===new URL(request.url).origin;
};
async function refresh(bucket) {
  const today=taipeiDate();
  const history=await load(bucket);
  const conf=await get(bucket,'strategy',defaults);
  if (!history.days.length) return {date:null,state:'請先匯入歷史資料。'};
  const last=history.days.at(-1).date;
  if (last===today && await bucket.head('recommendation/'+today)) {
    await settleObservations(bucket,history.days);
    return {date:today,state:'今日推薦已保存。'};
  }
  const markets=[];
  for(let date=last===today ? today : shiftDate(last,1); date<=today;date=shiftDate(date,1)) {
    if (!weekday(date)) continue;
    if (markets.length===4) break;
    markets.push(date);
  }
  const updates=[];
  const calendars=new Map();
  for(const date of markets) {
    const found=await fetchSources(dailyUrls(date));
    const {day,coverage}=normalizeDay(found.result,date);
    if (!marketComplete(day) && (!day || date===today)) {
      if(!day && !coverage.tw && !coverage.ot && date<today) {
        const month=date.slice(0,7);
        if(!calendars.has(month)){
          const report=await jsonFetch(monthlyTradingUrl(date)).catch(()=>null);
          calendars.set(month,listedTradingDates(report,date));
        }
        const days=calendars.get(month);
        const confirmed=days && (month<today.slice(0,7)||[...days].some(d=>d>date));
        if(confirmed&&!days.has(date))continue;
      }
      return {date:history.days.at(-1).date,state:'等待核對交易日、行情或法人資料。',coverage,errors:found.failed,updates};
    }
    const frame=await recordDay(bucket,history,day,conf);
    updates.push(date);
    if (date===today&&!frame) return {date,state:'已更新價量與籌碼，等待公司與財報資料。',updates};
  }
  return {date:history.days.at(-1).date,state:updates.length ? '已更新交易日與推薦。' : '目前沒有新交易日。',updates};
}
async function recordDay(bucket,history,day,conf,provided) {
  if (await bucket.head('recommendation/'+day.date)) {
    await settleObservations(bucket,history.days);
    return history.frames[day.date];
  }
  const preview={...history,days:[...history.days.filter(d=>d.date!==day.date),day].sort((a,b)=>a.date.localeCompare(b.date))};
  const analyzed=await priceRuleHistory(bucket,preview,conf);
  const frame=await getFund(day,analyzed,conf,provided);
  const saved=await saveDay(bucket,{day,frame});
  history.days=preview.days.map(d=>d.date===day.date?saved.day:d);
  if (saved.frame) history.frames[day.date]=saved.frame;
  if (day.date===taipeiDate() && saved.frame && history.days.at(-1)?.date===day.date) {
    const dailyData={days:analyzed.days.map(d=>d.date===day.date?saved.day:d),frames:history.frames};
    await create(bucket,'recommendation/'+day.date,selectCurrent(dailyData,conf,true));
  }
  await settle(bucket,history.days);
  await settleObservations(bucket,history.days);
  return saved.frame;
}
const dayQuality=pack=>pack.frame?2:marketComplete(pack.day)?1:0;
async function saveDay(bucket,pack) {
  const key='day/'+pack.day.date;
  for(let attempt=0;attempt<3;attempt++) {
    const object=await bucket.get(key);
    const previous=object?await object.json():null;
    if(previous && dayQuality(previous)>=dayQuality(pack))return previous;
    const condition=previous?{etagMatches:object.etag}:{etagDoesNotMatch:'*'};
    if(await put(bucket,key,pack,{onlyIf:condition}))return pack;
  }
  throw new Error('Concurrent daily data update');
}
const finalStates=new Set(['done','missing','unfilled','action','calendar']);
const stockId=id=>/^[LO][1-9]\d{3}$/.test(id)&&!id.slice(1).startsWith('91');
function recommendationRows(pack,days,index) {
  const recent=index>=4?days.slice(index-4,index+1):[];
  const continuous=recent.length===5&&recent.every((day,i)=>!day.uncertain&&
    (!i||!day.gapBefore&&day.date<=shiftDate(recent[i-1].date,7)));
  const conf=pack.config??defaults;
  return pack.rows.map(original=>{
    if(original.signal)return original;
    let row=original;
    if(continuous&&![row.chipRatio,row.buyDays,row.sellDays].every(Number.isFinite)){
      const bars=recent.map(day=>day.rows.find(bar=>bar[0]===row.id));
      const sameFlows=[[7,row.foreign],[8,row.trust],[10,row.active]].every(([column,value])=>Number.isFinite(value)&&
        bars.every(bar=>Number.isFinite(bar?.[column]))&&Math.abs(bars.reduce((sum,bar)=>sum+bar[column],0)/1000-value)<1e-8);
      const ratio=sameFlows?chipFlowPercent(row,bars):null;
      if(Number.isFinite(ratio)&&(!Number.isFinite(row.chipRatio)||Math.abs(row.chipRatio-ratio)<1e-8)){
        row={...row,chipRatio:row.chipRatio??ratio,...chipFlowDays(bars)};
      }
    }
    return {...row,signal:recommendationSignal(row,conf)};
  });
}
function attachSignals(rows,picks) {
  const signals=new Map(picks.map(row=>[row.id,row.signal]));
  return rows.map(row=>{
    const signal=signals.get(row.id);
    return {...row,signal:signal&&signal.kind!=='unknown'?signal:row.signal??{kind:'unknown'}};
  });
}
function trackedRows(pack, days, maps) {
  const i=days.findIndex(d=>d.date===pack.date);
  const conf=pack.config??defaults;
  return recommendationRows(pack,days,i).map(r=>({
    date:pack.date,id:r.id,name:r.name,score:r.score,forecast:r.forecast,bullish:r.bullish,horizon:conf.horizon,
    version:pack.version,signal:r.signal,...(i<0 ? {status:'missing'} : trade(days,maps,i,r.id,conf))
  }));
}
async function settle(bucket,days) {
  const maps=indexes(days);
  await limited(days.slice(-26,-1),async day=>{
    const key='settled/'+day.date;
    if(await bucket.head(key)) return;
    const pack=await get(bucket,'recommendation/'+day.date);
    if(!pack) return;
    const rows=trackedRows(pack,days,maps);
    if(rows.every(r=>finalStates.has(r.status))) await create(bucket,key,rows);
  });
}
const observationPrefix='observation90/';
function observePack(pack,i,days,maps) {
  return recommendationRows(pack,days,i).map(p=>({...observePick({...p,date:pack.date},i,days,maps),version:pack.version,signal:p.signal}));
}
async function settleObservations(bucket,days) {
  const latest=days.at(-1)?.date;
  if(!latest||!days[0]||shiftDate(days[0].date,90)>latest)return;
  const [picks,finished]=await Promise.all([allKeys(bucket,'recommendation/'),allKeys(bucket,observationPrefix)]);
  const done=new Set(finished);
  const ready=picks.map(k=>k.slice('recommendation/'.length)).filter(date=>
    date>=days[0].date&&shiftDate(date,90)<=latest&&!done.has(observationPrefix+date));
  if(!ready.length)return;
  const maps=indexes(days);
  await limited(ready,async date=>{
    const pack=await get(bucket,'recommendation/'+date);
    const i=days.findIndex(d=>d.date===date);
    if(!pack||i<0)return;
    const rows=observePack(pack,i,days,maps);
    await put(bucket,observationPrefix+date,rows,{onlyIf:{etagDoesNotMatch:'*'},
      customMetadata:{summary:JSON.stringify(observationTotals(rows,pack.version))}});
  });
}
async function observationSummaries(bucket) {
  let cursor;
  const summaries=[];
  do{
    const page=await bucket.list({prefix:observationPrefix,cursor,limit:500,include:['customMetadata']});
    for(const object of page.objects){
      if(object.customMetadata?.summary)summaries.push(JSON.parse(object.customMetadata.summary));
    }
    cursor=page.truncated?page.cursor:undefined;
  }while(cursor);
  return combineObservationTotals(summaries);
}
async function observations(bucket,days,before) {
  const [keys,groups]=await Promise.all([allKeys(bucket,'recommendation/'),observationSummaries(bucket)]);
  const past=keys.map(k=>k.slice('recommendation/'.length)).filter(date=>!before||date<before);
  const dates=past.slice(-12).reverse();
  const maps=indexes(days);
  const rows=(await limited(dates,async date=>{
    const saved=await get(bucket,observationPrefix+date);
    if(saved?.every(row=>row.signal))return saved;
    const pack=await get(bucket,'recommendation/'+date);
    if(!pack)return saved??[];
    const i=days.findIndex(d=>d.date===date);
    return saved?attachSignals(saved,recommendationRows(pack,days,i)):observePack(pack,i,days,maps);
  })).flat();
  return {asOf:days.at(-1)?.date??null,rows,groups,next:past.length>12?dates.at(-1):null};
}
async function track(bucket,data,before='') {
  const {days}=data;
  const maps=indexes(days);
  const keys=await allKeys(bucket,'recommendation/');
  const past=keys.filter(k=>!before||k.slice(15)<before);
  const packs=await limited(past.slice(-60).reverse(),k=>get(bucket,k));
  const joined=[];
  const settled=await limited(packs.filter(Boolean),async pack=>{
    const saved=await get(bucket,'settled/'+pack.date);
    if(!saved)return trackedRows(pack,days,maps);
    return attachSignals(saved,recommendationRows(pack,days,days.findIndex(day=>day.date===pack.date)));
  });
  for(const rows of settled) joined.push(...rows);
  const done=joined.filter(r=>r.status==='done');
  const forecastRows=done.filter(r=>Number.isFinite(r.forecast?.prob));
  const mean=(items,fn)=>items.length ? items.reduce((a,r)=>a+fn(r),0)/items.length : null;
  return {joined,next:past.length>60?packs.at(-1)?.date:null,logs:packs.filter(Boolean).map(p=>({date:p.date,count:p.rows.length,config:p.config,version:p.version})),
    summary:{total:joined.length,done:done.length,win:mean(done,r=>r.net>0?100:0),net:mean(done,r=>r.net),
      brier:mean(forecastRows,r=>(r.forecast.prob/100-Number(r.gross>0))**2),
      mae:mean(forecastRows,r=>Math.abs(r.forecast.upside-r.gross)),forecastCount:forecastRows.length}};
}
async function status(bucket) {
  const [data,history]=await Promise.all([load(bucket),archiveList(bucket)]);
  const dates=data.days.map(d=>d.date);
  const last=dates.at(-1);
  const today=taipeiDate();
  const keys=await allKeys(bucket,'recommendation/');
  return {date:last,today,days:dates.length,start:dates[0],liveSessions:keys.length,historical:historyCoverage(history,data.days),
    listedFlowDays:data.days.filter(d=>d.coverage.tc>=650).length,
    otcFlowDays:data.days.filter(d=>d.coverage.oc>=550).length,
    latestSaved:keys.at(-1)?.slice(15) ?? null,count:data.days.at(-1)?.rows.length ?? 0,
    coverage:data.days.at(-1)?.coverage,frame:!!data.frames[last],
    note:last===today?'最新交易日':'目前為最近已取得交易日'};
}
async function mcp(request,bucket) {
  const rpc=await request.json();
  const withId=result=>json({jsonrpc:'2.0',id:rpc.id??null,result});
  if (!rpc.id && rpc.method?.startsWith('notifications/')) return new Response(null,{status:202});
  if (rpc.method==='server/discover') return withId({supportedVersions:['2026-07-28'],capabilities:{tools:{}}});
  if (rpc.method==='initialize') return withId({protocolVersion:rpc.params?.protocolVersion??'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'Taiwan Equity Lab',version:VERSION}});
  if (rpc.method==='tools/list') return withId({tools:endpointTools});
  if (rpc.method==='ping') return withId({});
  if (rpc.method==='tools/call') {
    const name=rpc.params?.name;
    try {
      if (!endpointTools.some(t=>t.name===name)) throw new Error('Unknown tool');
      const value=name===endpointTools[0].name ? await refresh(bucket) : await status(bucket);
      return withId({content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value});
    } catch(e) {
      return withId({content:[{type:'text',text:e.message}],isError:true});
    }
  }
  return json({jsonrpc:'2.0',id:rpc.id??null,error:{code:-32601,message:'Method not found'}});
}
export async function api(request,env,snapshotStyle='') {
  const url=new URL(request.url);
  const bucket=env.BUCKET;
  const method=request.method;
  const path=url.pathname;
  if (!bucket) return json({error:'資料儲存尚未連線。'},503);
  if (method==='POST' && !trustedOrigin(request)) return json({error:'來源無效。'},403);
  try {
    if (path==='/mcp'&&method==='POST') return mcp(request,bucket);
    if (path==='/api/initial'&&method==='POST') {
      if (await bucket.head('initial.gz')) return json({error:'歷史資料已建立。'},409);
      const payload=await request.arrayBuffer();
      if (payload.byteLength<10 || payload.byteLength>15e6) return json({error:'歷史資料容量不符。'},400);
      const body=new Blob([payload]).stream().pipeThrough(new DecompressionStream('gzip'));
      const seed=await new Response(body).json();
      if (!Array.isArray(seed.days) || !seed.days.length || seed.days.some((d,i)=>
        !valid(d?.date)||d.date>taipeiDate()||(i>0&&d.date<=seed.days[i-1].date)||
        !Array.isArray(d.rows)||!(d.coverage?.tw>=800&&d.coverage?.ot>=650))) return json({error:'歷史資料格式不符。'},400);
      await bucket.put('initial.gz',payload,{onlyIf:{etagDoesNotMatch:'*'}});
      return json({dates:seed.days.length,latest:seed.days.at(-1).date});
    }
    if (path==='/api/status'&&method==='GET') return json(await status(bucket));
    if (path==='/api/history/import'&&method==='POST') {
      const month=url.searchParams.get('month')??'';
      const result=await acceptHistory(bucket,month,await request.arrayBuffer(),taipeiDate());
      if(!result)return json({error:'請提供有效的月度歷史資料。'},400);
      if(result.conflict)return json({error:'已有涵蓋更完整的資料，或同一月份正在更新。'},409);
      return json(result);
    }
    if (path==='/api/refresh'&&method==='POST') return json(await refresh(bucket));
    if (path==='/api/fundamentals/refresh'&&method==='POST') return json(await refreshResearch(bucket,env.fetchSources));
    if(path==='/api/disclosures/import'&&method==='POST'){
      const body=await request.text();
      if(body.length>2_000_000)return json({error:'公告資料超過大小限制。'},400);
      let input;
      try {input=JSON.parse(body);} catch {return json({error:'公告資料格式不符。'},400);}
      return json(await saveDisclosureFeeds(bucket,input,taipeiDate()));
    }
    if (path==='/api/ingest'&&method==='POST') {
      const input=await request.json();
      const today=taipeiDate();
      const date=input.date;
      if(!valid(date)||date>today||date<shiftDate(today,-45)) return json({error:'更新日期超出範圍。'},400);
      const {day,coverage}=normalizeDay(input.market ?? {},date);
      const [history,conf]=await Promise.all([load(bucket),get(bucket,'strategy',defaults)]);
      if(!history.days.length) return json({error:'請先匯入歷史資料。'},409);
      if(date<history.days.at(-1).date && !history.days.some(d=>d.date===date)) {
        return json({error:'已有較晚的交易日，補入舊日期會改變持有天數。'},409);
      }
      if(date===today && !marketComplete(day) && validFundamentals(input.fundamentals??{})) {
        const research=normalizeFundamentals(input.fundamentals,date);
        await addCash(history,history.days.at(-1),research,conf);
        await put(bucket,'research',research);
      }
      if(!day || (date===today && !marketComplete(day))) return json({date,state:'兩市場行情或法人資料未完整。',coverage},422);
      const frame=await recordDay(bucket,history,day,conf,{result:input.fundamentals??{},failed:[]});
      return json({date,coverage,saved:!!await bucket.head('recommendation/'+date),frame:!!frame});
    }
    if (path==='/api/settings'&&method==='GET') return json(await get(bucket,'strategy',defaults));
    if (path==='/api/settings'&&method==='POST') {
      const value=config(await request.json());
      await put(bucket,'strategy',value);
      return json(value);
    }
    if (path==='/api/picks'&&method==='GET') {
      const [data,conf]=await Promise.all([load(bucket),get(bucket,'strategy',defaults)]);
      return json(await latestPicks(bucket,data,conf));
    }
    if(path==='/export.html'&&method==='GET'){
      const [data,conf]=await Promise.all([load(bucket),get(bucket,'strategy',defaults)]);
      const [picks,tracking,reviews]=await Promise.all([
        latestPicks(bucket,data,conf),track(bucket,data),observations(bucket,data.days)
      ]);
      const now=new Date();
      const date=taipeiDate(now);
      const exportedAt=new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',dateStyle:'medium',timeStyle:'short',hourCycle:'h23'}).format(now);
      const filename='taiwan-equity-lab-'+date+'.html';
      const html=renderHtmlSnapshot({picks,tracking,observations:reviews,conf,origin:url.origin,exportedAt,style:snapshotStyle});
      return new Response(html,{headers:{
        'Content-Type':'text/html;charset=utf-8',
        'Content-Disposition':'attachment; filename="'+filename+'"',
        'Cache-Control':'private, no-store',
        'X-Content-Type-Options':'nosniff'
      }});
    }
    if (path==='/api/backtest'&&method==='POST') {
      const input=await request.json();
      const mode=['full','technical'].includes(input.mode)?input.mode:'baseline';
      const conf=config(mode==='technical'?{...input.config,tech:100,chip:0,fund:0}:input.config);
      const start=valid(input.start)?input.start:'';
      const end=valid(input.end)?input.end:'';
      if((input.start&&!start)||(input.end&&!end))return json({error:'請輸入有效的交易日期。'},400);
      if(start&&end&&start>end) return json({error:'起始日須早於結束日。'},400);
      if(mode!=='full' && conf.rules.some(r=>fundFields.has(r.field))) return json({error:'請改選三面向，才能回測基本面條件。'},400);
      if(mode==='technical' && conf.rules.some(r=>chipFields.has(r.field))) return json({error:'請改選價量＋籌碼或三面向，才能回測籌碼條件。'},400);
      const [{days,frames},archives,keys]=await Promise.all([load(bucket),archiveList(bucket),allKeys(bucket,'day/')]);
      const options={start,end,mode,settleThroughEnd:input.settleThroughEnd===true};
      const series=historySeries(bucket,archives,keys,days,options);
      const result=await streamStudy(series,frames,conf,options);
      return json({mode,version:VERSION,daily:result.daily,rows:result.history,coverage:result.coverage});
    }
    if (path==='/api/track'&&method==='GET') {
      const before=url.searchParams.get('before') ?? '';
      return json(await track(bucket,await load(bucket),valid(before)?before:''));
    }
    if(path==='/api/observations'&&method==='GET'){
      const before=url.searchParams.get('before')??'';
      return json(await observations(bucket,(await load(bucket)).days,valid(before)?before:''));
    }
    if (path==='/api/stock/history'&&method==='GET') {
      const id=url.searchParams.get('id')??'';
      if(!stockId(id))return json({error:'請輸入上市或上櫃普通股代碼。'},400);
      const [{days},archives,keys]=await Promise.all([load(bucket),archiveList(bucket),allKeys(bucket,'day/')]);
      const today=taipeiDate();
      const start=asDate(String(Number(today.slice(0,4))-3)+today.slice(4))??shiftDate(today,-1095);
      const bars=[];
      for await(const {day} of historySeries(bucket,archives,keys,days,{start})){
        if(day.date<start)continue;
        const r=day.rows.find(row=>row[0]===id);
        if(r)bars.push({date:day.date,open:r[1],high:r[2],low:r[3],close:r[4],volume:r[5],amount:r[6],
          foreign:r[7],trust:r[8],dealer:r[9],dealerSelf:r[10],dealerHedge:r[11]});
      }
      if(!bars.length)return json({error:'這個市場及股票代碼目前沒有歷史行情。'},404);
      const last=bars.at(-1).date;
      const fed=await finmindHistory(id.slice(1),bars[0].date,last);
      const tradingDates=new Set(bars.map(r=>r.date));
      for(const k of ['institutions','valuation'])fed.series[k]=fed.series[k].filter(r=>tradingDates.has(r.date));
      return json({id,requested:{start,end:today},observed:{start:bars[0].date,end:last},bars,...fed,
        note:'財報與月營收依來源期間列出，歷史回測另須可驗證的公開日期。'});
    }
    if (['/api/stock','/api/analysis'].includes(path)&&method==='GET') {
      const id=url.searchParams.get('id') ?? '';
      if (!stockId(id)) return json({error:'請輸入上市或上櫃普通股代碼。'},400);
      const analysis=path==='/api/analysis';
      const [{days,frames},research]=await Promise.all([load(bucket),get(bucket,'research')]);
      const history=days.flatMap(d=>d.rows.filter(r=>r[0]===id).map(r=>({date:d.date,open:r[1],high:r[2],low:r[3],close:r[4],volume:r[5],name:r[14]})));
      const recent=history.at(-1);
      if(!recent) return json({error:'這個代碼目前沒有價量資料。'},404);
      const today=taipeiDate();
      const disclosures=analysis?readCompanyDisclosures(bucket,id,today):null;
      const latest=days.findLastIndex(day=>day.date===recent.date);
      let bars=stockRecentBars(days.slice(0,latest+1),id);
      let indicators=priceIndicators(bars,detailIndicators,isEvent);
      const flowFields=['foreign20','trust20','active20'];
      const hasFlows=()=>bars.length>=20&&bars.slice(-20).every(row=>row&&[row[7],row[8],row[10]].every(Number.isFinite));
      if(Object.keys(indicators).length<detailIndicators.length||(analysis&&!hasFlows())){
        const verified=[];
        for await(const day of verifiedRecentDays(bucket,days,recent.date)){
          const row=day.rows.find(bar=>bar[0]===id);
          verified.push({date:day.date,gapBefore:day.gapBefore,uncertain:day.uncertain,rows:row?[row]:[]});
        }
        bars=stockRecentBars(verified,id);
        indicators=priceIndicators(bars,detailIndicators,isEvent);
      }
      const captured=Object.values(frames).reverse().find(f=>f.records[id]);
      const frame=research?.records[id] && (!captured || research.asOf>captured.asOf) ? research : captured;
      let cash=frame?.cash?.[id]??null;
      try {if(!cash) cash=await cashFlow(id.slice(1),today);} catch {}
      const report={id,name:frame?.records[id]?.name??recent.name,info:frame?.records[id],asOf:frame?.asOf,cash,indicators,history:history.slice(-45)};
      if(!analysis)return json(report);
      const tail=bars.slice(-20);
      return json({...report,marketAsOf:days.at(-1).date,peers:compareIndustry(frame?.records,id),
        ownership:{...chips(bars),...(tail.length===20&&tail.every(Boolean)?flowIndicators(tail,flowFields):{})},
        disclosures:await disclosures});
    }
    return json({error:'找不到此功能。'},404);
  } catch(e) {
    console.error(path,e.message);
    return json({error:'資料服務暫時無法完成此請求。'},503);
  }
}
