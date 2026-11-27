import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { asDate, normalizeDay } from '../src/data.mjs';

const [source, output, through]=process.argv.slice(2);
if (!source || !output || !through) throw new Error('Usage: node scripts/seed.mjs SOURCE OUTPUT THROUGH');
const paths=await readdir(source);
const calendar=[...new Set(paths.map(x=>x.match(/^(\d{8})-(tw|ot|tc|oc)\.json$/)?.[1]).filter(Boolean))].sort();
const days=[];
for (const rawDate of calendar) {
  const date=asDate(rawDate);
  if(date>through) continue;
  const all={};
  await Promise.all(['tw','ot','tc','oc'].map(async k=>{
    try {all[k]=JSON.parse(await readFile(join(source,rawDate+'-'+k+'.json'),'utf8'));}
    catch(e) {if(e.code!=='ENOENT') throw e;}
  }));
  const {day}=normalizeDay(all,date);
  if(day) days.push(day);
}
if(days.length<25) throw new Error('Not enough complete quotes');
const bytes=gzipSync(JSON.stringify({days,frames:{}}),{level:9});
await writeFile(output,bytes);
console.log({window:[days[0].date,days.at(-1).date],days:days.length,listedFlowDays:days.filter(d=>d.coverage.tc>=650).length,otcFlowDays:days.filter(d=>d.coverage.oc>=550).length,bytes:bytes.length});
