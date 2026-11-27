import { adjustedBars, flowIndicators, kdFromBars, priceIndicators, priceWindows, reportIndicators } from './indicators.mjs';

export const VERSION = '1.4';
export const defaults = {
  horizon: 5, limit: 5, market: 'all', score: 60, amount: 20, fee: 0.1425, tax: 0.3, slip: 0.1,
  tech: 45, fund: 25, chip: 30, rules: []
};
const ruleGroup=(label,sections)=>({label,sections,fields:Object.assign({},...Object.values(sections))});
export const ruleGroups = {
  technical: ruleGroup('技術面',{
    '價格與動能':{close:'收盤價（元）',open:'開盤價（元）',high:'最高價（元）',low:'最低價（元）',
      change:'單日漲跌（%）',return5:'5 日漲跌（%）',return10:'10 日漲跌（%）',momentum:'20 日漲跌（%）',return60:'60 日漲跌（%）'},
    '均線與趨勢':{ma5:'5 日均線（SMA，元）',ma10:'10 日均線（SMA，元）',ma20:'20 日均線（SMA，元）',ma60:'60 日均線（SMA，元）',
      ema20:'EMA 指數均線（20 日，元）',ema50:'EMA 指數均線（50 日，元）',vwma20:'VWMA 成交量加權均線（20 日，元）',
      distanceMa5:'距 5 日均線（%）',distanceMa10:'距 10 日均線（%）',above:'距 20 日均線（%）',distanceMa60:'距 60 日均線（%）',
      maSpread5To20:'5 日與 20 日均線差（%）',adx14:'DMI 趨勢強度 ADX（14 日）',plusDi14:'DMI 正向指標 +DI（14 日）',minusDi14:'DMI 負向指標 −DI（14 日）',
      supertrend:'Supertrend 超級趨勢線（10 日，3 倍 ATR，元）',supertrendDirection:'Supertrend 趨勢方向（1 多、−1 空）'},
    '動能與震盪':{k9:'KD 的 K 值（9 日）',d9:'KD 的 D 值（9 日）',j9:'KDJ 的 J 值（9 日）',rsi6:'RSI（6 日）',rsi14:'RSI（14 日）',
      macd:'MACD 快慢線差（DIF）',macdSignal:'MACD 訊號線（9 日）',macdHistogram:'MACD 柱狀差（DIF－訊號線）',
      williamsR14:'Williams %R 威廉指標（14 日）',cci20:'CCI 順勢指標（20 日）',awesomeOscillator:'AO 動能震盪指標（5／34 日）'},
    '波動與通道':{bollingerPosition:'布林通道 %B（20 日，%）',bollingerWidth:'布林通道寬度（20 日，%）',
      bollingerUpper:'布林通道上軌（20 日，元）',bollingerMiddle:'布林通道中軌（20 日，元）',bollingerLower:'布林通道下軌（20 日，元）',
      atr14:'ATR 平均真實波幅（14 日，元）',atr14Pct:'ATR／收盤價（14 日，%）',volatility20:'歷史波動率（20 日，年化 %）',
      donchianHigh20:'Donchian 唐奇安通道上軌（前 20 日，元）',donchianLow20:'Donchian 唐奇安通道下軌（前 20 日，元）',
      donchianHighGap20:'距 Donchian 唐奇安通道上軌（%）',donchianLowGap20:'距 Donchian 唐奇安通道下軌（%）',
      high20Gap:'距 20 日最高價（%）',high60Gap:'距 60 日最高價（%）',low20Gap:'距 20 日最低價（%）',low60Gap:'距 60 日最低價（%）'},
    '量能與資金流':{dailyLots:'單日成交量（張）',dailyValue:'單日成交額（百萬元）',averageVolume20:'20 日均成交量（張）',
      volume:'成交量比',amount:'20 日均成交額（百萬元）',obv20:'OBV 能量潮 20 日變化（張）',
      mfi14:'MFI 資金流量指標（14 日）',cmf20:'CMF 蔡金資金流（20 日，%）'},
    '評分':{tech:'技術分數'}
  }),
  ownership: ruleGroup('籌碼面',{
    '集保持股分級':{holders1000:'千張大戶（人，逾 100 萬股）',holders15Pct:'千張大戶持股（%）',
      holders400:'四百張以上大戶（人，逾 40 萬股）',holders400Pct:'四百張以上大戶持股（%）',
      smallHolders:'未滿一張持有人數（人）',smallHoldersPct:'未滿一張持股（%）'},
    '外資與投信':{foreign1:'外資 1 日買賣超（張）',foreign:'外資 5 日買賣超（張）',foreign10:'外資 10 日買賣超（張）',foreign20:'外資 20 日買賣超（張）',
      trust1:'投信 1 日買賣超（張）',trust:'投信 5 日買賣超（張）',trust10:'投信 10 日買賣超（張）',trust20:'投信 20 日買賣超（張）'},
    '自營商':{dealer1:'自營商 1 日買賣超（張）',dealer:'自營商 5 日買賣超（張）',dealer10:'自營商 10 日買賣超（張）',dealer20:'自營商 20 日買賣超（張）',
      active:'自營商自行 5 日買賣超（張）',active20:'自營商自行 20 日買賣超（張）',hedge:'自營商避險 5 日買賣超（張）'},
    '合計與成交量占比':{institution1:'三類法人 1 日合計買賣超（張）',institution5:'三類法人 5 日合計買賣超（張）',
      institution20:'三類法人 20 日合計買賣超（張）',foreign5Pct:'外資 5 日淨買超占成交量（%）',
      trust5Pct:'投信 5 日淨買超占成交量（%）',institution20Pct:'三類法人 20 日淨買超占成交量（%）',chip:'籌碼分數'}
  }),
  fundamentals: ruleGroup('基本面',{
    '營收與成長':{revenue:'月營業額（百萬元）',monthlyMoM:'月營收月增（%）',yoy:'月營收年增（%）',
      priorMonthRevenue:'上月營收（百萬元）',priorYearRevenue:'去年同月營收（百萬元）',
      cumulativeRevenue:'年度累計營收（百萬元）',cumulativeYoY:'年度累計營收年增（%）'},
    '財報獲利':{eps:'財報 EPS（元）',reportRevenue:'財報營業收入（百萬元）',profit:'本期淨利（百萬元）',
      operatingProfit:'財報營業利益（百萬元）',grossMargin:'財報毛利率（%）',operatingMargin:'財報營益率（%）',netMargin:'財報淨利率（%）'},
    '估值與現金流':{pe:'本益比（倍）',pb:'股價淨值比（倍）',dividendYield:'現金殖利率（%）',earningsYield:'盈餘殖利率（%）',
      ocf:'營業現金流（百萬元）',fcf:'自由現金流（百萬元）',capex:'資本支出（百萬元）',
      cashConversion:'自由現金流占營業現金流（%）',fund:'基本分數'}
  })
};
export const ruleFields=Object.assign({},...Object.values(ruleGroups).map(r=>r.fields));
export const fundFields=new Set(Object.keys(ruleGroups.fundamentals.fields));
export const chipFields=new Set(Object.keys(ruleGroups.ownership.fields));
export const cashFields=new Set(['ocf','fcf','capex','cashConversion']);
const usesPriceWindow=field=>Object.hasOwn(priceWindows,field);
export const lookbackFor=c=>Math.max(20,...c.rules.map(r=>priceWindows[r.field]??0));
export const groups = [['foreign','外資'], ['trust','投信'], ['active','自營商自行買賣'], ['hedge','自營商避險']];
const cost = (s, r) => Math.max(0, Math.min(s, r));
const bound = (n) => cost(100, n);
const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;
const scale = (x, slope) => bound(50 + slope * x);
export function config(input = {}) {
  input=input??{};
  const o = { ...defaults };
  for (const k of ['score','amount','fee','tax','slip','tech','fund','chip']) {
    const n = Number(input[k]);
    if (input[k] !== '' && input[k] != null && Number.isFinite(n) && n >= 0) o[k] = Math.min(n, k === 'amount' ? 100000 : ['fee','tax','slip'].includes(k) ? 5 : 100);
  }
  for (const [k, valid] of Object.entries({horizon:[1,3,5,10,20],limit:[3,4,5],market:['all','L','O']})) {
    if (valid.includes(input[k])) o[k] = input[k];
  }
  if (Array.isArray(input.rules)) o.rules = input.rules.filter(r => r && Object.hasOwn(ruleFields, r.field) &&
    ['gte','lte','gt','lt','eq'].includes(r.op) && r.value != null && r.value !== '' && Number.isFinite(Number(r.value)))
    .slice(0, 20).map(r => ({field:r.field,op:r.op,value:Number(r.value)}));
  if (!(o.tech + o.fund + o.chip)) return { ...o, tech: defaults.tech, fund: defaults.fund, chip: defaults.chip };
  return o;
}
const ops = {gte:(a,b)=>a>=b,lte:(a,b)=>a<=b,gt:(a,b)=>a>b,lt:(a,b)=>a<b,eq:(a,b)=>a===b};
function canCompare(metric, r) {
  return Number.isFinite(metric[r.field]) && ops[r.op](metric[r.field],r.value);
}
export function isEvent(r, last) {
  return Boolean(r[12] || (r[13]>0 && last>0 && Math.abs(r[13]-last)>=.0099));
}
function technical(rows, r) {
  const price = r[4];
  let multiplier = 1;
  const prices = [price];
  for (let j=rows.length-2; j>=0; j--) {
    const next = rows[j+1];
    const reference = next[13];
    if (reference > 0 && isEvent(next, rows[j][4])) multiplier *= reference / rows[j][4];
    else if (next[12]) return null;
    prices.push(rows[j][4] * multiplier);
  }
  const momentum = 100 * (price / prices[20] - 1);
  const above = 100 * (price / mean(prices.slice(0,20)) - 1);
  const volume = r[5] / mean(rows.slice(0,20).map(x=>x[5]));
  const amount = mean(rows.slice(1).map(x=>x[6])) / 1e6;
  const change = 100 * (price / prices[1] - 1);
  const tech = .5 * scale(momentum, 2) + .35 * scale(above, 5) + .15 * scale((volume - 1) * Math.sign(change), 24);
  return {close:price,open:r[1],high:r[2],low:r[3],dailyLots:r[5]/1000,dailyValue:r[6]/1e6,momentum,above,volume,amount,change,tech};
}
export function stochasticKD(rows) {
  if(rows.length<9)return null;
  const bars=adjustedBars(rows,isEvent);
  return bars?kdFromBars(bars):null;
}
export function chipFlowPercent({foreign,trust,active},bars) {
  if(bars.length!==5||!bars.every(row=>Number.isFinite(row?.[5]))||
    ![foreign,trust,active].every(Number.isFinite))return null;
  const lots=bars.reduce((sum,row)=>sum+row[5],0)/1000;
  return lots>0?100*(foreign+trust+active)/lots:null;
}
export const chipScale=20;
export const chipScore=ratio=>Number.isFinite(ratio)?50+50*Math.tanh(ratio/chipScale):null;
export function chipFlowDays(bars) {
  if(bars.length!==5||!bars.every(row=>row&&[row[7],row[8],row[10]].every(Number.isFinite)))return {};
  const daily=bars.map(row=>row[7]+row[8]+row[10]);
  return {buyDays:daily.filter(value=>value>0).length,sellDays:daily.filter(value=>value<0).length};
}
export function chips(rows) {
  const span = rows.slice(-5);
  const sum = (i) => span.length===5&&span.every(r => Number.isFinite(r?.[i])) ? span.reduce((a,r)=>a+r[i],0) / 1000 : null;
  const [foreign, trust, dealer, active, hedge] = [7,8,9,10,11].map(sum);
  const named = {foreign,trust,dealer,active,hedge};
  const chipRatio=chipFlowPercent(named,span);
  const chip=chipScore(chipRatio);
  const leader = groups.filter(([key]) => named[key] > 0).sort((a,b)=>named[b[0]]-named[a[0]])[0];
  return {...named,chip,chipRatio,...chipFlowDays(span),leader:leader?.[1] ?? '無明顯淨買超'};
}
export const signalThresholds={flow:2,flowDays:3,tech:60,score:70,probability:60};
export const signalLabels={buy:'建議購入',accumulation:'主力建倉訊號',pressure:'籌碼賣壓',watch:'觀察',unknown:'資料待核對'};
export function marketSignal(row,conf=defaults) {
  const {flow,flowDays,tech,score,probability}=signalThresholds;
  const {buyDays,sellDays,chipRatio,forecast}=row;
  if(![buyDays,sellDays,chipRatio].every(Number.isFinite))return 'watch';
  if(chipRatio<=-flow&&sellDays>=flowDays)return 'pressure';
  if(chipRatio<flow||buyDays<flowDays)return 'watch';
  if(row.tech>=tech&&row.score>=score&&forecast?.prob>=probability&&forecast.n>=30&&forecast.days>=10&&Number.isFinite(forecast.upside)){
    const entry=(1+conf.fee/100)*(1+conf.slip/100);
    const exit=(1+forecast.upside/100)*(1-(conf.fee+conf.tax)/100)*(1-conf.slip/100);
    if(exit>entry)return 'buy';
  }
  return 'accumulation';
}
export function recommendationSignal(row,conf) {
  if(![row.buyDays,row.sellDays,row.chipRatio].every(Number.isFinite))return {kind:'unknown'};
  const kind=marketSignal(row,conf);
  if(kind==='watch')return {kind};
  const direction=kind==='pressure'?-1:1;
  const flows=[['外資',row.foreign],['投信',row.trust],['自營商自行',row.active]];
  const leader=flows.filter(([,value])=>direction*value>0).sort((a,b)=>direction*(b[1]-a[1]))[0]?.[0];
  return {kind,days:direction<0?row.sellDays:row.buyDays,ratio:row.chipRatio,leader,
    ...(kind==='buy'?{prob:row.forecast.prob,upside:row.forecast.upside}:{})};
}
export function fundamentalFactors({yoy,eps,pe,ocf}) {
  return [
    ['yoy', Number.isFinite(yoy) ? scale(yoy,1.35) : null,.40],
    ['eps', Number.isFinite(eps) ? (eps > 0 ? 75 : 25) : null,.25],
    ['pe', pe > 0 ? bound(92 - pe * 1.5) : null,.20],
    ['ocf', Number.isFinite(ocf) ? (ocf > 0 ? 75 : 25) : null,.15]
  ].filter(([, value])=>value!==null);
}
function fundamentals(f, cash) {
  if (!f) return {fund:null, yoy:null, eps:null, pe:null, pb:null, ocf:null,revenue:null,holders1000:null};
  const { yoy = null, eps = null, pe = null, pb = null, yield: dividend = null } = f;
  const ocf = cash?.ocf ?? null;
  const factors = fundamentalFactors({yoy,eps,pe,ocf});
  const fund = factors.length >= 2 ? factors.reduce((a,[,x,w])=>a+x*w,0) / factors.reduce((a,[,,w])=>a+w,0) : null;
  return {fund,yoy,eps,pe:pe>0?pe:null,pb:pb>0?pb:null,dividend,ocf,
    revenue:Number.isFinite(f.revenue)?f.revenue/1000:null,holders1000:f.holders1000??null,info:f,cash};
}
function score(metric, conf, useFund) {
  const ws = [[metric.tech,conf.tech], [metric.chip,conf.chip]];
  if (useFund && conf.fund > 0) ws.push([metric.fund,conf.fund]);
  let sum = 0, weight = 0;
  for (const [x,w] of ws) {
    if (!w) continue;
    if (x === null) return null;
    sum += x*w;
    weight += w;
  }
  return weight ? sum / weight : null;
}
export function indexes(days) {
  return days.map(d=>Object.assign(new Map(d.rows.map(r=>[r[0],r])),{gapBefore:Boolean(d.gapBefore)}));
}
export function candidates(day, i, maps, conf, frame, useFund) {
  const lookback=lookbackFor(conf);
  if (i < lookback || (useFund && !frame)) return [];
  if (!useFund && conf.rules.some(r=>fundFields.has(r.field))) return [];
  if (maps.slice(i-lookback+1,i+1).some(day=>day.gapBefore))return [];
  const result = [];
  const priceRules=conf.rules.filter(r=>usesPriceWindow(r.field));
  const flowRules=conf.rules.filter(r=>chipFields.has(r.field)).map(r=>r.field);
  const snapshotRules=conf.rules.some(r=>fundFields.has(r.field)||/^(holders|smallHolders)/.test(r.field));
  for (const r of day.rows) {
    const id = r[0];
    if (conf.market !== 'all' && id[0] !== conf.market) continue;
    const company = frame?.records[id];
    if (useFund && !company) continue;
    const rows = [];
    for (let j=i-20; j<=i; j++) rows.push(maps[j].get(id));
    if (rows.some(x=>!x)) continue;
    const t = technical(rows, r);
    if (!t || t.amount < conf.amount) continue;
    const cash=frame?.cash?.[id];
    const detail={...t,...chips(rows),...fundamentals(company,cash)};
    const grade=score(detail,conf,useFund);
    if(grade===null||grade<conf.score)continue;
    if(snapshotRules)Object.assign(detail,reportIndicators(company,cash));
    if(flowRules.length)Object.assign(detail,flowIndicators(rows,flowRules));
    if(!conf.rules.every(rule=>usesPriceWindow(rule.field)||canCompare(detail,rule)))continue;
    if(priceRules.length){
      const span=lookback===20?rows:maps.slice(i-lookback,i+1).map(m=>m.get(id));
      Object.assign(detail,priceIndicators(span,priceRules.map(r=>r.field),isEvent));
      if(!priceRules.every(rule=>canCompare(detail,rule)))continue;
    }
    result.push({id, name:company?.name ?? r[14], date:day.date, score:grade, ...detail});
  }
  return result.sort((a,b)=>b.score-a.score || a.id.localeCompare(b.id)).slice(0,conf.limit);
}
export function priceLimit(reference,upper) {
  if(!(reference>0))return null;
  const target=Math.round(reference*100)*(upper?110:90);
  const bands=[[1000,1],[5000,5],[10000,10],[50000,50],[100000,100],[Infinity,500]];
  const tick=bands.find(([boundary])=>target<boundary*100)[1];
  const rounded=upper?Math.floor(target/(tick*100)):Math.ceil(target/(tick*100));
  return Math.max(1,rounded*tick)/100;
}
function limitOnDay(bar,previous,upper) {
  const official=previous[upper?15:16];
  if(official>0)return official;
  const reference=bar[13] ?? (bar[12]?null:previous[4]);
  return priceLimit(reference,upper);
}
const samePrice=(actual,expected)=>expected!==null && Math.abs(actual-expected)<.005;
export function trade(days, maps, i, id, c) {
  const entry = days[i+1]?.date;
  const exit = days[i+c.horizon]?.date;
  const a = maps[i+1]?.get(id);
  const b = maps[i+c.horizon]?.get(id);
  if (!entry) return {status:'waiting'};
  const observed=days.slice(i+1,i+c.horizon+1);
  if(observed.some(d=>d.uncertain||d.gapBefore))return {status:'calendar',entry,exit};
  const p = maps[i]?.get(id);
  if (!a || !p) return {status:'missing', entry};
  if (samePrice(a[1],limitOnDay(a,p,true)) && a[1]===a[3]) return {status:'unfilled',entry};
  if (a[12] && !(a[13]>0) && !(p[15]>0) && a[1]===a[2] && a[1]===a[3]) return {status:'action',entry};
  if (!exit) {
    const last = maps.at(-1).get(id);
    return {status:'holding', entry, open:a[1], last:last?.[4]};
  }
  if (!b) return {status:'missing', entry, exit};
  for (let j=i+2; j<=i+c.horizon; j++) {
    const r = maps[j].get(id), prev = maps[j-1].get(id);
    if (!r || !prev) return {status:'missing',entry,exit};
    if (isEvent(r, prev[4])) return {status:'action',entry,exit};
  }
  const previous = maps[i+c.horizon-1]?.get(id);
  if (previous && samePrice(b[4],limitOnDay(b,previous,false)) && b[4]===b[2]) return {status:'unfilled',entry,exit};
  const entryCost = a[1]*(1+c.fee/100)*(1+c.slip/100);
  const exitValue = b[4]*(1-(c.fee+c.tax)/100)*(1-c.slip/100);
  return {status:'done', entry, exit, open:a[1], close:b[4], gross:100*(b[4]/a[1]-1), net:100*(exitValue/entryCost-1)};
}
export function study(days, maps, conf, frames, {start='',end='',mode='baseline',selections=false} = {}) {
  const fit = [];
  const history = [];
  const daily = [];
  for (let i=lookbackFor(conf); i<days.length; i++) {
    const d = days[i];
    if (d.date < start || (end && d.date > end)) continue;
    const recorded=frames[d.date];
    const frame=recorded?.asOf===d.date?recorded:null;
    if (mode==='full'&&!frame)continue;
    const picks = candidates(d,i,maps,conf,frame,mode === 'full');
    const rows = picks.map(p=>{
      const t = trade(days,maps,i,p.id,conf);
      return { date:d.date,id:p.id,name:p.name,score:p.score,...t };
    });
    const done = rows.filter(r=>r.status==='done');
    if (done.length) daily.push({date:d.date, net:mean(done.map(r=>r.net)), win:100*done.filter(r=>r.net>0).length/done.length,n:done.length});
    fit.push(...done);
    if (selections) history.push(...rows);
  }
  return { fit, history, daily };
}
export function forecast(pick, models, signalDate) {
  const assessed = models.filter(r=>r.exit < signalDate && r.id[0]===pick.id[0] && Math.abs(r.score-pick.score)<=10);
  const dates = new Set(assessed.map(r=>r.date)).size;
  if (assessed.length < 30 || dates < 10) return {prob:null,upside:null,n:assessed.length,days:dates};
  const wins = assessed.filter(x=>x.gross > 0).length;
  return {prob:100 * (wins + 5) / (assessed.length + 10), upside:mean(assessed.map(r=>r.gross)),n:assessed.length,days:dates};
}
