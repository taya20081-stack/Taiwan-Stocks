import { shiftDate } from './data.mjs';
import { isEvent, signalLabels } from './model.mjs';

const checkpoints90=[30,60,90];
export function observePick(pick,signalIndex,days,maps) {
  const date=days[signalIndex]?.date??pick.date;
  const end=shiftDate(date,90);
  const asOf=days.at(-1)?.date;
  const entry=days[signalIndex+1];
  const points=[];
  const values={date,id:pick.id,name:pick.name,bullish:pick.bullish,end,entry:entry?.date,points,
    checkpoints:Object.fromEntries(checkpoints90.map(n=>[n,null])),high:null,low:null,latest:null};
  if(signalIndex<0)return {...values,state:'missing'};
  const complete=asOf>=end;
  if(!entry||entry.date>end)return {...values,state:complete?'missing':'waiting'};
  const open=maps[signalIndex+1]?.get(pick.id)?.[1];
  if(!(open>0))return {...values,state:'missing'};

  let basis=open;
  let issue=null;
  for(let i=signalIndex+1;i<days.length&&days[i].date<=end;i++){
    const day=days[i];
    const bar=maps[i].get(pick.id);
    if(day.gapBefore||day.uncertain||day.date>shiftDate(days[i-1].date,7)){
      issue={date:day.date,state:'calendar'};
      break;
    }
    if(!bar){
      issue={date:day.date,state:'missing'};
      break;
    }
    if(i>signalIndex+1){
      const prior=maps[i-1].get(pick.id);
      if(isEvent(bar,prior[4])){
        if(!(bar[13]>0)){
          issue={date:day.date,state:'action'};
          break;
        }
        basis*=bar[13]/prior[4];
      }
    }
    points.push({date:day.date,value:100*(bar[4]/basis-1)});
  }
  for(const n of checkpoints90){
    const cutoff=shiftDate(date,n);
    if(asOf>=cutoff&&(!issue||issue.date>cutoff))values.checkpoints[n]=points.findLast(p=>p.date<=cutoff)??null;
  }
  const performance=points.map(p=>p.value);
  if(performance.length){
    values.high=Math.max(...performance);
    values.low=Math.min(...performance);
    values.latest=points.at(-1);
  }
  return {...values,state:issue?.state??(complete?'complete':'observing'),issueDate:issue?.date};
}

export function observationTotals(rows,version) {
  const signals={};
  for(const row of rows){
    const value=row.checkpoints[90]?.value;
    if(!Number.isFinite(value))continue;
    const kind=row.signal?.kind??'unknown';
    const target=signals[kind]??={n:0,positive:0,sum:0};
    target.n++;
    target.positive+=Number(value>0);
    target.sum+=value;
  }
  return {version,signals};
}
export function combineObservationTotals(totals) {
  const groups=new Map();
  for(const item of totals){
    const entries=item.signals?Object.entries(item.signals):[['unknown',item.bullish],['unknown',item.watch]];
    for(const [kind,group] of entries){
      if(!group?.n)continue;
      const signal=Object.hasOwn(signalLabels,kind)?kind:'unknown';
      const key=item.version+'/'+signal;
      const previous=groups.get(key)??{version:item.version,signal,n:0,positive:0,sum:0};
      groups.set(key,{...previous,n:previous.n+group.n,positive:previous.positive+group.positive,sum:previous.sum+group.sum});
    }
  }
  return [...groups.values()].map(({version,signal,n,positive,sum})=>({version,signal,n,win:100*positive/n,average:sum/n}));
}
