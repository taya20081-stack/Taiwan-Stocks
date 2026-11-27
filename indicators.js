const indicatorMean=values=>values.reduce((sum,n)=>sum+n,0)/values.length;
const relative=(value,base)=>base>0?100*(value/base-1):null;
const perMillion=value=>Number.isFinite(value)?value/1000:null;

export function adjustedBars(rows,isEvent) {
  const bars=new Array(rows.length);
  let factor=1;
  for(let i=rows.length-1;i>=0;i--){
    const row=rows[i];
    const next=rows[i+1];
    if(next&&isEvent(next,row[4])){
      if(!(next[13]>0))return null;
      factor*=next[13]/row[4];
    }
    bars[i]=[row[2]*factor,row[3]*factor,row[4]*factor];
  }
  return bars;
}
export function kdFromBars(bars) {
  let k9=50,d9=50;
  for(let i=8;i<bars.length;i++){
    let high=-Infinity,low=Infinity;
    for(let j=i-8;j<=i;j++){
      high=Math.max(high,bars[j][0]);
      low=Math.min(low,bars[j][1]);
    }
    const rsv=high===low?50:100*(bars[i][2]-low)/(high-low);
    k9=(2*k9+rsv)/3;
    d9=(2*d9+k9)/3;
  }
  return {k9,d9};
}
function emaSeries(values,period) {
  const alpha=2/(period+1);
  const result=[indicatorMean(values.slice(0,period))];
  for(let i=period;i<values.length;i++)result.push(result.at(-1)+alpha*(values[i]-result.at(-1)));
  return result;
}
function wilder(values,period) {
  let average=indicatorMean(values.slice(0,period));
  for(let i=period;i<values.length;i++)average+=(values[i]-average)/period;
  return average;
}
function rsiValue(closes,period) {
  const changes=closes.slice(1).map((close,i)=>close-closes[i]);
  const gain=wilder(changes.map(n=>Math.max(n,0)),period);
  const loss=wilder(changes.map(n=>Math.max(-n,0)),period);
  return gain+loss>0?100*gain/(gain+loss):50;
}
function trueRanges(bars) {
  return bars.slice(1).map(([high,low],i)=>{
    const close=bars[i][2];
    return Math.max(high-low,Math.abs(high-close),Math.abs(low-close));
  });
}
function directionalMovement(bars) {
  const period=14;
  const moves=bars.slice(1).map(([high,low],i)=>{
    const up=high-bars[i][0],down=bars[i][1]-low;
    return [up>0&&up>down?up:0,down>0&&down>up?down:0];
  });
  const ranges=trueRanges(bars);
  let range=indicatorMean(ranges.slice(0,period));
  let plus=indicatorMean(moves.slice(0,period).map(row=>row[0]));
  let minus=indicatorMean(moves.slice(0,period).map(row=>row[1]));
  const dx=[];
  for(let i=period-1;i<ranges.length;i++){
    if(i>=period){
      range+=(ranges[i]-range)/period;
      plus+=(moves[i][0]-plus)/period;
      minus+=(moves[i][1]-minus)/period;
    }
    dx.push(plus+minus>0?100*Math.abs(plus-minus)/(plus+minus):0);
  }
  return {adx14:wilder(dx,period),plusDi14:range>0?100*plus/range:0,minusDi14:range>0?100*minus/range:0};
}
function supertrendValues(bars) {
  const period=10,multiplier=3;
  const ranges=trueRanges(bars);
  let atr=indicatorMean(ranges.slice(0,period)),upper=Infinity,lower=-Infinity,up=false;
  for(let i=period;i<bars.length;i++){
    if(i>period)atr+=(ranges[i-1]-atr)/period;
    const [high,low,close]=bars[i];
    const midpoint=(high+low)/2,previous=bars[i-1][2];
    const nextUpper=midpoint+multiplier*atr,nextLower=midpoint-multiplier*atr;
    if(nextUpper<upper||previous>upper)upper=nextUpper;
    if(nextLower>lower||previous<lower)lower=nextLower;
    up=up?close>=lower:close>upper;
  }
  return {supertrend:up?lower:upper,supertrendDirection:up?1:-1};
}
function volumePriceIndicators(bars,volumes,requested) {
  const values={};
  if(!volumes.every(n=>Number.isFinite(n)&&n>=0))return values;
  if(requested.includes('mfi14')){
    const typical=bars.map(([high,low,close])=>(high+low+close)/3);
    let positive=0,negative=0;
    for(let i=1;i<bars.length;i++){
      const flow=typical[i]*volumes[i];
      if(typical[i]>typical[i-1])positive+=flow;
      if(typical[i]<typical[i-1])negative+=flow;
    }
    values.mfi14=positive+negative>0?100*positive/(positive+negative):50;
  }
  if(requested.includes('obv20')){
    values.obv20=bars.slice(1).reduce((sum,bar,i)=>sum+Math.sign(bar[2]-bars[i][2])*volumes[i+1],0)/1000;
  }
  if(requested.includes('cmf20')||requested.includes('vwma20')){
    const total=volumes.reduce((a,b)=>a+b,0);
    if(requested.includes('cmf20')){
      const flow=bars.reduce((sum,[high,low,close],i)=>sum+(high>low?(2*close-high-low)/(high-low)*volumes[i]:0),0);
      values.cmf20=total>0?100*flow/total:null;
    }
    if(requested.includes('vwma20'))values.vwma20=total>0?bars.reduce((sum,bar,i)=>sum+bar[2]*volumes[i],0)/total:null;
  }
  return values;
}
export const priceWindows={
  k9:49,d9:49,j9:49,rsi6:49,rsi14:49,macd:69,macdSignal:69,macdHistogram:69,atr14:49,atr14Pct:49,
  ma5:4,ma10:9,ma20:19,ma60:59,distanceMa5:4,distanceMa10:9,distanceMa60:59,maSpread5To20:19,
  ema20:69,ema50:69,adx14:49,plusDi14:49,minusDi14:49,supertrend:69,supertrendDirection:69,vwma20:19,
  return5:5,return10:10,return60:60,williamsR14:13,cci20:19,mfi14:14,awesomeOscillator:33,
  bollingerPosition:19,bollingerWidth:19,bollingerUpper:19,bollingerMiddle:19,bollingerLower:19,volatility20:20,
  donchianHigh20:20,donchianLow20:20,donchianHighGap20:20,donchianLowGap20:20,
  high20Gap:19,high60Gap:59,low20Gap:19,low60Gap:59,averageVolume20:19,obv20:20,cmf20:19
};
export function priceIndicators(rows,keys,isEvent) {
  const byWindow=new Map();
  const result={};
  for(const key of keys){
    const size=priceWindows[key]+1;
    if(!byWindow.has(size))byWindow.set(size,[]);
    byWindow.get(size).push(key);
  }
  for(const [size,requested] of byWindow){
    const range=rows.slice(-size);
    if(range.length!==size||range.some(row=>!row||![row[2],row[3],row[4]].every(n=>Number.isFinite(n)&&n>0)))continue;
    const bars=adjustedBars(range,isEvent);
    if(!bars)continue;
    const closes=bars.map(bar=>bar[2]);
    const close=closes.at(-1);
    const values={};
    if(requested.some(key=>['k9','d9','j9'].includes(key))){
      Object.assign(values,kdFromBars(bars));
      values.j9=3*values.k9-2*values.d9;
    }
    if(requested.some(key=>key.startsWith('macd'))){
      const fast=emaSeries(closes,12);
      const slow=emaSeries(closes,26);
      const lines=slow.map((value,i)=>fast[i+14]-value);
      values.macd=lines.at(-1);
      values.macdSignal=emaSeries(lines,9).at(-1);
      values.macdHistogram=values.macd-values.macdSignal;
    }
    if(requested.some(key=>key.startsWith('bollinger'))){
      const middle=indicatorMean(closes);
      const width=4*Math.sqrt(indicatorMean(closes.map(value=>(value-middle)**2)));
      values.bollingerWidth=middle>0?width/middle*100:null;
      values.bollingerPosition=width>0?(close-middle+width/2)/width*100:null;
      values.bollingerUpper=middle+width/2;
      values.bollingerMiddle=middle;
      values.bollingerLower=middle-width/2;
    }
    if(requested.some(key=>key.startsWith('donchian'))){
      const prior=bars.slice(0,-1);
      const high=Math.max(...prior.map(bar=>bar[0])),low=Math.min(...prior.map(bar=>bar[1]));
      Object.assign(values,{donchianHigh20:high,donchianLow20:low,donchianHighGap20:relative(close,high),donchianLowGap20:relative(close,low)});
    }
    if(requested.some(key=>['adx14','plusDi14','minusDi14'].includes(key)))Object.assign(values,directionalMovement(bars));
    if(requested.some(key=>key.startsWith('supertrend')))Object.assign(values,supertrendValues(bars));
    if(requested.some(key=>key.startsWith('atr14'))){
      values.atr14=wilder(trueRanges(bars),14);
      values.atr14Pct=100*values.atr14/close;
    }
    if(requested.some(key=>['mfi14','obv20','cmf20','vwma20'].includes(key)))Object.assign(values,volumePriceIndicators(bars,range.map(row=>row[5]),requested));
    for(const key of requested){
      if(Object.hasOwn(values,key))result[key]=values[key];
      else if(/^ma\d/.test(key))result[key]=indicatorMean(closes);
      else if(key==='maSpread5To20')result[key]=relative(indicatorMean(closes.slice(-5)),indicatorMean(closes));
      else if(key.startsWith('distanceMa'))result[key]=relative(close,indicatorMean(closes));
      else if(key.startsWith('ema'))result[key]=emaSeries(closes,Number(key.slice(3))).at(-1);
      else if(key.startsWith('return'))result[key]=relative(close,closes[0]);
      else if(key.startsWith('rsi'))result[key]=rsiValue(closes,Number(key.slice(3)));
      else if(key==='awesomeOscillator'){
        const midpoints=bars.map(([high,low])=>(high+low)/2);
        result[key]=indicatorMean(midpoints.slice(-5))-indicatorMean(midpoints);
      }
      else if(key.startsWith('high'))result[key]=relative(close,Math.max(...bars.map(bar=>bar[0])));
      else if(key.startsWith('low'))result[key]=relative(close,Math.min(...bars.map(bar=>bar[1])));
      else if(key==='williamsR14'){
        const high=Math.max(...bars.map(bar=>bar[0])),low=Math.min(...bars.map(bar=>bar[1]));
        result[key]=high>low?-100*(high-close)/(high-low):-50;
      } else if(key==='cci20'){
        const prices=bars.map(([high,low,last])=>(high+low+last)/3);
        const average=indicatorMean(prices);
        const deviation=indicatorMean(prices.map(price=>Math.abs(price-average)));
        result[key]=deviation>0?(prices.at(-1)-average)/(.015*deviation):0;
      } else if(key==='volatility20'){
        const changes=closes.slice(1).map((value,i)=>Math.log(value/closes[i]));
        const mean=indicatorMean(changes);
        const variance=indicatorMean(changes.map(value=>(value-mean)**2));
        result[key]=100*Math.sqrt(252*variance);
      } else if(key==='averageVolume20'){
        const volumes=range.map(row=>row[5]);
        if(volumes.every(n=>Number.isFinite(n)&&n>=0))result[key]=indicatorMean(volumes)/1000;
      }
    }
  }
  return result;
}
const institutionColumns={foreign:7,trust:8,dealer:9,active:10,hedge:11};

export function flowIndicators(rows,requested) {
  const result={};
  const columnSum=(span,index)=>span.every(row=>Number.isFinite(row[index]))?
    span.reduce((total,row)=>total+row[index],0):null;
  for(const field of requested){
    const match=field.match(/^(foreign|trust|dealer|active|hedge|institution)(1|5|10|20)(Pct)?$/);
    if(!match)continue;
    const [,actor,length,pct]=match;
    const span=rows.slice(-Number(length));
    const columns=actor==='institution'?[7,8,9]:[institutionColumns[actor]];
    const values=columns.map(index=>columnSum(span,index));
    const volume=span.reduce((total,row)=>total+row[5],0);
    if(values.some(n=>n===null)||(pct&&!(volume>0)))continue;
    const shares=values.reduce((sum,n)=>sum+n,0);
    result[field]=pct?100*shares/volume:shares/1000;
  }
  return result;
}

export function reportIndicators(f,cash) {
  if(!f)return {};
  return {
    monthlyMoM:f.monthlyMoM, priorMonthRevenue:perMillion(f.priorMonthRevenue),
    priorYearRevenue:perMillion(f.priorYearRevenue), cumulativeRevenue:perMillion(f.cumulativeRevenue),
    cumulativeYoY:f.cumulativeYoY, profit:perMillion(f.profit), operatingMargin:f.margin,
    grossMargin:f.grossMargin, netMargin:f.netMargin, reportRevenue:perMillion(f.reportRevenue),
    operatingProfit:perMillion(f.operatingProfit), dividendYield:f.yield,
    earningsYield:f.pe>0?100/f.pe:null, fcf:cash?.fcf, capex:cash?.capex,
    cashConversion:cash?.ocf>0&&Number.isFinite(cash.fcf)?100*cash.fcf/cash.ocf:null,
    holders400:f.holders400, holders15Pct:f.holders15Pct, holders400Pct:f.holders400Pct,
    smallHolders:f.smallHolders, smallHoldersPct:f.smallHoldersPct
  };
}
