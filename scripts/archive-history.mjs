import { readdir,readFile,mkdir,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { asDate,normalizeDay,shiftDate } from '../src/data.mjs';

const [source,target,from,through]=process.argv.slice(2);
if(!source||!target||!from||!through)throw new Error('Usage: node scripts/archive-history.mjs source target from through');
const files=await readdir(source);
const months=[...new Set(files.map(f=>asDate(f.slice(0,8))?.slice(0,7)).filter(Boolean))].sort();
await mkdir(target,{recursive:true});
const read=async name=>{
  try{return JSON.parse(await readFile(join(source,name),'utf8'));}
  catch(e){if(e.code!=='ENOENT')throw e;}
};
for(const month of months){
  const key=month.replace('-','')+'01';
  const calendar=await read(key+'-calendar.json');
  const official=calendar?.date===key&&Array.isArray(calendar.data)&&calendar.data.length?
    new Set(calendar.data.map(r=>asDate(r[0])).filter(d=>d?.startsWith(month+'-'))):null;
  const days=[];
  for(let date=month+'-01';date.startsWith(month+'-')&&date<=through;date=shiftDate(date,1)){
    if(date<from)continue;
    const weekday=new Date(date+'T00:00:00Z').getUTCDay();
    if(official ? !official.has(date) : weekday===0||weekday===6)continue;
    const stem=date.replaceAll('-','');
    const parts=['tw','ot','tc','oc'];
    const found=await Promise.all(parts.map(k=>read(stem+'-'+k+'.json')));
    const {day}=normalizeDay(Object.fromEntries(parts.map((k,i)=>[k,found[i]])),date,{partial:true});
    const [quotes,release,collector,totals,events]=await Promise.all(
      ['release-quotes','release-flows','collector-flows','totals-flows','release-events'].map(k=>read(stem+'-'+k+'.json')));
    const rows=new Map(day.rows.map(r=>[r[0],r]));
    for(const row of quotes??[]) if(!rows.has(row[0]))rows.set(row[0],row);
    const fallbackFlows={L:new Set(),O:new Set()};
    for(const [id,...flow] of [...(release??[]),...(collector??[]),...(totals??[])]){
      const row=rows.get(id);
      if(!row||!flow.slice(0,3).every(Number.isFinite))continue;
      for(let i=0;i<5;i++)if(Number.isFinite(flow[i]))row[7+i]??=flow[i];
      if(row.slice(7,12).every(Number.isFinite))fallbackFlows[id[0]].add(id);
    }
    for(const [id,reference] of Object.entries(events??{})){
      const row=rows.get(id);
      if(!row)continue;
      row[12]=1;
      row[13]??=reference;
    }
    day.rows=[...rows.values()];
    const listed=day.rows.filter(r=>r[0][0]==='L').length;
    day.coverage.listedRows=listed;
    day.coverage.otcRows=day.rows.length-listed;
    day.coverage.tc=Math.max(day.coverage.tc,fallbackFlows.L.size);
    day.coverage.oc=Math.max(day.coverage.oc,fallbackFlows.O.size);
    days.push({...day,uncertain:!official&&!day.rows.length});
  }
  if(!days.some(d=>d.rows.length))continue;
  await writeFile(join(target,month+'.gz'),gzipSync(JSON.stringify({days}),{level:6}));
  console.log(month,days.length,days.filter(d=>d.coverage.listedRows>=650).length,
    days.filter(d=>d.coverage.otcRows>=500).length,days.filter(d=>d.coverage.tc>=650).length,days.filter(d=>d.coverage.oc>=550).length);
}
