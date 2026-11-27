import test from 'node:test';
import assert from 'node:assert/strict';
import { shiftDate, taipeiDate } from '../src/data.mjs';
import { indexes } from '../src/model.mjs';
import { observePick } from '../src/observation.mjs';
import { api } from '../src/server.mjs';

const samplePick={id:'L2330',name:'台積電',bullish:true};

function daily(date,close,open=close,reference=null){
  return {date,rows:[[samplePick.id,open,close,open,close,1000,100000,0,0,0,0,0,0,reference,'台積電']]};
}
function observationStorage(values) {
  return {
    async list({prefix}){return {objects:[...values].filter(([key])=>key.startsWith(prefix)).map(([key,entry])=>({key,customMetadata:entry.metadata}))};},
    async head(key){return values.get(key)??null;},
    async get(key){const record=values.get(key);return record?{json:async()=>structuredClone(record.value)}:null;},
    async put(key,body,options){
      if(values.has(key)&&options.onlyIf)return null;
      values.set(key,{value:JSON.parse(body),metadata:options.customMetadata});
      return {};
    }
  };
}

test('the 90-calendar-day window completes on the next available session but uses the last close through the deadline',()=>{
  const start='2026-01-01';
  const days=Array.from({length:32},(_,i)=>daily(shiftDate(start,i*3),100+i,100));
  days.splice(30,1);
  const result=observePick(samplePick,0,days,indexes(days));
  assert.equal(result.entry,'2026-01-04');
  assert.equal(result.state,'complete');
  assert.equal(result.checkpoints[90].date,shiftDate(start,87));
  assert.ok(Math.abs(result.checkpoints[90].value-29)<1e-9);
  assert.equal(result.checkpoints[60].date,shiftDate(start,60));
  assert.equal(result.points.length,29);
});

test('company action adjustment uses the official reference price and leaves unknown events unresolved',()=>{
  const days=[daily('2026-01-02',100),daily('2026-01-05',100,100),daily('2026-01-06',55,50,50)];
  const adjusted=observePick(samplePick,0,days,indexes(days));
  assert.equal(adjusted.state,'observing');
  assert.ok(Math.abs(adjusted.latest.value-10)<1e-9);
  days[2].rows[0][12]=1;
  days[2].rows[0][13]=null;
  const unverified=observePick(samplePick,0,days,indexes(days));
  assert.equal(unverified.state,'action');
  assert.equal(unverified.latest.date,'2026-01-05');
  assert.equal(unverified.checkpoints[90],null);
});

test('daily refresh persists matured observations once and the new tab reads their summaries',async()=>{
  const today=taipeiDate();
  const start=shiftDate(today,-93);
  const values=new Map();
  for(let i=0;i<=31;i++){
    const date=shiftDate(start,i*3);
    values.set('day/'+date,{value:{day:daily(date,100+i,100)},metadata:{}});
  }
  for(const date of [start,today])values.set('recommendation/'+date,{value:{date,rows:[samplePick],version:'1.2'},metadata:{}});
  const before=values.size;
  const bucket=observationStorage(values);
  const invoke=(path,method='GET')=>api(new Request('https://lab.test'+path,{method}),{BUCKET:bucket});
  assert.equal((await invoke('/api/refresh','POST')).status,200);
  assert.equal((await invoke('/api/refresh','POST')).status,200);
  const response=await invoke('/api/observations');
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(values.size-before,1);
  assert.equal(result.rows.length,2);
  assert.equal(result.rows[0].state,'waiting');
  assert.equal(result.rows[1].state,'complete');
  assert.equal(result.groups[0].n,1);
  assert.equal(result.groups[0].win,100);
  assert.equal(result.groups[0].version,'1.2');
});

test('daily picks, legacy settlements and 90-day records share the signal from the original date',async()=>{
  const days=[40,40,40,-10,40,-100].map((flow,i)=>{
    const day=daily(shiftDate('2026-11-16',i),100);
    day.rows[0][7]=flow;
    return day;
  });
  const latest=days.at(-1).date, earlier=days[4].date;
  const values=new Map(days.map(day=>['day/'+day.date,{value:{day}}]));
  const signal={kind:'pressure',days:4,ratio:-3,leader:'投信'};
  values.set('recommendation/'+latest,{value:{date:latest,rows:[{...samplePick,signal}]} });
  values.set('recommendation/'+earlier,{value:{date:earlier,rows:[{...samplePick,foreign:.15,trust:0,active:0}]} });
  values.set('settled/'+earlier,{value:[{...samplePick,date:earlier,status:'done',net:1}]});
  const bucket=observationStorage(values);
  const read=async path=>(await api(new Request('https://lab.test'+path),{BUCKET:bucket})).json();
  const [picks,tracked,observed]=await Promise.all(['/api/picks','/api/track','/api/observations'].map(read));
  assert.deepEqual(picks.rows[0].signal,signal);
  assert.deepEqual(tracked.joined[0].signal,signal);
  assert.deepEqual(observed.rows[0].signal,signal);
  assert.deepEqual(tracked.joined[1].signal,{kind:'accumulation',days:4,ratio:3,leader:'外資'});
  assert.deepEqual(observed.rows[1].signal,tracked.joined[1].signal);
  assert.equal(tracked.joined[1].status,'done');
  const download=await api(new Request('https://lab.test/export.html'),{BUCKET:bucket},'.card{margin:1rem}');
  assert.match(download.headers.get('Content-Disposition'),/^attachment; filename="taiwan-equity-lab-\d{4}-\d{2}-\d{2}\.html"$/);
  assert.equal(download.headers.get('Cache-Control'),'private, no-store');
  const html=await download.text();
  assert.match(html,/<style>\.card\{margin:1rem\}/);
  assert.match(html,/90 天觀察/);
  assert.match(html,/籌碼賣壓/);
  assert.match(html,/主力建倉訊號/);
  assert.match(html,/https:\/\/lab\.test\/#analysis\/L2330/);
  assert.doesNotMatch(html,/<script\b/);
});
