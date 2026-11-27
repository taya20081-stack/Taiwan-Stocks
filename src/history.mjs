import { asDate, shiftDate } from './data.mjs';
import { indexes, lookbackFor, study } from './model.mjs';

const historyPrefix='history/';
const datePattern=/^\d{4}-\d{2}-\d{2}$/;
const monthPattern=/^\d{4}-\d{2}$/;
const keyForMonth=month=>historyPrefix+month+'.gz';
const validDay=date=>datePattern.test(date)&&asDate(date)===date;

export function archiveMetadata(days) {
  const dates=pred=>days.filter(pred).map(d=>d.date).join(',');
  return {first:days[0].date,last:days.at(-1).date,
    sessions:dates(d=>!d.uncertain), listed:dates(d=>d.coverage.listedRows>=650),
    otc:dates(d=>d.coverage.otcRows>=500), listedFlows:dates(d=>d.coverage.listedRows>=650&&d.coverage.tc>=650),
    otcFlows:dates(d=>d.coverage.otcRows>=500&&d.coverage.oc>=550)};
}
export async function unpackHistory(body) {
  return new Response(body.pipeThrough(new DecompressionStream('gzip'))).json();
}
export function validArchive(month,days,today) {
  if(!monthPattern.test(month) || !Array.isArray(days) || !days.length || days.length>31) return false;
  return days.every((d,i)=>validDay(d?.date)&&d.date.startsWith(month+'-')&&d.date<today&&
    (!i||d.date>days[i-1].date)&&Array.isArray(d.rows)&&d.rows.every(r=>Array.isArray(r)&&/^[LO][1-9]\d{3}$/.test(r[0])&&!/^[LO]91/.test(r[0]))&&
    d.coverage && ['listedRows','otcRows','tc','oc'].every(k=>Number.isInteger(d.coverage[k])&&d.coverage[k]>=0));
}
export async function archiveList(bucket) {
  let cursor;
  const objects=[];
  do {
    const page=await bucket.list({prefix:historyPrefix,cursor,include:['customMetadata']});
    objects.push(...page.objects);
    cursor=page.truncated?page.cursor:undefined;
  } while(cursor);
  return objects.sort((a,b)=>a.key.localeCompare(b.key));
}
export async function acceptHistory(bucket,month,bytes,today) {
  if(bytes.byteLength<10||bytes.byteLength>8e6)return null;
  const {days}=await unpackHistory(new Blob([bytes]).stream());
  if(!validArchive(month,days,today))return null;
  const key=keyForMonth(month);
  const object=await bucket.head(key);
  const condition=object?{etagMatches:object.etag}:{etagDoesNotMatch:'*'};
  const meta=archiveMetadata(days);
  if(object) {
    const old=object.customMetadata??{};
    for(const k of ['sessions','listed','otc','listedFlows','otcFlows']){
      if((old[k]??'').split(',').some(date=>date&&!meta[k].split(',').includes(date)))return {conflict:true};
    }
  }
  return await bucket.put(key,bytes,{onlyIf:condition,customMetadata:meta})?
    {month,count:days.length,first:meta.first,last:meta.last}: {conflict:true};
}

const coverageFields=['sessions','listed','otc','listedFlows','otcFlows'];
export function historyCoverage(archives,recent) {
  const sets=Object.fromEntries(coverageFields.map(k=>[k,new Set()]));
  for (const item of archives) for(const k of coverageFields) {
    for(const d of (item.customMetadata?.[k]??'').split(','))if(d)sets[k].add(d);
  }
  for (const day of recent) {
    sets.sessions.add(day.date);
    if(day.coverage.tw>=800)sets.listed.add(day.date);
    if(day.coverage.ot>=650)sets.otc.add(day.date);
    if(day.coverage.tc>=650)sets.listedFlows.add(day.date);
    if(day.coverage.oc>=550)sets.otcFlows.add(day.date);
  }
  const dates=[...sets.sessions].sort();
  return {first:dates[0]??null,last:dates.at(-1)??null,...Object.fromEntries(coverageFields.map(k=>[k,sets[k].size]))};
}

function mergeBars(base,latest) {
  if(!base)return latest;
  const prior=new Map(base.rows.map(r=>[r[0],r]));
  for(const r of latest.rows){
    const old=prior.get(r[0]);
    if(!old || r.slice(1,7).some((v,i)=>v!==old[i+1]) || !old.some((value,i)=>value!=null&&r[i]==null)) prior.set(r[0],r);
    else prior.set(r[0],Array.from({length:Math.max(old.length,r.length)},(_,i)=>r[i]??old[i]));
  }
  const coverage=Object.fromEntries([...new Set([...Object.keys(base.coverage),...Object.keys(latest.coverage)])]
    .map(k=>[k,Math.max(base.coverage[k]??0,latest.coverage[k]??0)]));
  return {...latest,coverage,rows:[...prior.values()]};
}
export async function* historySeries(bucket,archives,dailyKeys,recent,{start='',end='',settleThroughEnd=false,warmupDays=120}={}) {
  const firstMonth=start?shiftDate(start,-warmupDays).slice(0,7):'';
  const lastMonth=end?(settleThroughEnd?end:shiftDate(end,75)).slice(0,7):'9999-12';
  const archiveByMonth=new Map(archives.map(a=>[a.key.slice(historyPrefix.length,-3),a.key]));
  const recentByDate=new Map(recent.map(day=>[day.date,day]));
  const dayKeysByMonth=Map.groupBy(dailyKeys,k=>k.slice(4,11));
  const recentByMonth=Map.groupBy(recent,d=>d.date.slice(0,7));
  const months=[...new Set([...archiveByMonth.keys(),...dayKeysByMonth.keys(),...recentByMonth.keys()])].sort();
  let prior;
  for(const month of months){
    if(month<firstMonth||month>lastMonth)continue;
    const days=new Map();
    const archiveKey=archiveByMonth.get(month);
    if(archiveKey){
      const object=await bucket.get(archiveKey);
      if(object){
        const archive=await unpackHistory(object.body);
        for(const d of archive.days)days.set(d.date,d);
      }
    }
    const frames={};
    for(const key of dayKeysByMonth.get(month)??[]){
      const date=key.slice(4);
      if(recentByDate.has(date))continue;
      const object=await bucket.get(key);
      if(!object)continue;
      const pack=await object.json();
      days.set(date,mergeBars(days.get(date),pack.day));
      if(pack.frame)frames[date]=pack.frame;
    }
    for(const day of recentByMonth.get(month)??[])days.set(day.date,mergeBars(days.get(day.date),day));
    for(const day of [...days.values()].sort((a,b)=>a.date.localeCompare(b.date))){
      if(settleThroughEnd&&end&&day.date>end)return;
      const gapBefore=Boolean(prior&&day.date>shiftDate(prior,7));
      yield {day:gapBefore?{...day,gapBefore}:day,frame:frames[day.date]};
      prior=day.date;
    }
  }
}

export async function streamStudy(series,currentFrames,conf,options={}) {
  const history=[],daily=[];
  const lookback=lookbackFor(conf),batchSize=25;
  let buffer=[],maps=[],frames={},frameCount=0,first=null,latest=null;
  const execute=n=>{
    if(buffer.length<=lookback)return;
    const start=buffer[lookback].date> (options.start??'')?buffer[lookback].date:options.start;
    const cutoff=buffer[Math.min(lookback+n,buffer.length)-1].date;
    const end=options.end&&options.end<cutoff?options.end:cutoff;
    const block=study(buffer,maps,conf,frames,{...options,start,end,selections:true});
    history.push(...block.history);
    daily.push(...block.daily);
    for(const d of buffer.slice(lookback,lookback+n)){
      if(d.date>=start&&d.date<=end&&frames[d.date]?.asOf===d.date)frameCount++;
    }
    for(const d of buffer.slice(0,n))delete frames[d.date];
    buffer=buffer.slice(n);
    maps=maps.slice(n);
  };
  for await(const {day,frame} of series){
    buffer.push(day);
    maps.push(indexes([day])[0]);
    const relevant=frame??currentFrames[day.date];
    if(relevant)frames[day.date]=relevant;
    if(!day.uncertain&&day.rows.length){
      if(buffer.length>lookback&&!first)first=day.date;
      latest=day.date;
    }
    if(buffer.length>=lookback+batchSize+conf.horizon)execute(batchSize);
  }
  execute(Math.max(0,buffer.length-lookback));
  return {history,daily,coverage:{start:first,end:latest,frameCount}};
}
