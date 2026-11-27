export const TW = 'https://openapi.twse.com.tw/v1';
export const OT = 'https://www.tpex.org.tw/openapi/v1';
const TDCC='https://opendata.tdcc.com.tw/getOD.ashx?id=1-5';
export const reportTypes = ['ci', 'basi', 'fh', 'bd', 'ins', 'mim'];
export const num = (value) => {
  const s = String(value ?? '').replaceAll(',', '').trim();
  return s && Number.isFinite(Number(s)) ? Number(s) : null;
};
export const compact = (date) => date.replaceAll('-', '');
export const asDate = (value) => {
  const s = String(value ?? '').trim().replaceAll('/', '').replaceAll('-', '');
  if (/^\d{7}$/.test(s)) return asDate(String(Number(s.slice(0, 3)) + 1911) + s.slice(3));
  if (!/^\d{8}$/.test(s)) return null;
  const date=[s.slice(0, 4),s.slice(4, 6),s.slice(6, 8)].join('-');
  const t=new Date(date+'T00:00:00Z');
  return !Number.isNaN(t.valueOf()) && t.toISOString().slice(0,10)===date ? date : null;
};
export function taipeiDate(date = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(date);
}
export function shiftDate(date, n) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function dailyUrls(date) {
  const c = compact(date);
  const d = date.replaceAll('-', '/');
  return {
    tw: 'https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=' + c + '&type=ALLBUT0999&response=json',
    ot: 'https://www.tpex.org.tw/www/zh-tw/afterTrading/otc?date=' + d + '&id=&type=EW&response=json',
    tc: 'https://www.twse.com.tw/rwd/zh/fund/T86?date=' + c + '&selectType=ALLBUT0999&response=json',
    oc: 'https://www.tpex.org.tw/www/zh-tw/insti/dailyTrade?date=' + d + '&type=Daily&sect=EW&response=json'
  };
}
export const fundamentalUrls = {
  tm: TW + '/opendata/t187ap03_L', om: OT + '/mopsfin_t187ap03_O',
  tr: TW + '/opendata/t187ap05_L', or: OT + '/mopsfin_t187ap05_O',
  tv: TW + '/exchangeReport/BWIBBU_ALL', ov: OT + '/tpex_mainboard_peratio_analysis',
  ...Object.fromEntries(reportTypes.flatMap(type => [
    ['t_' + type, TW + '/opendata/t187ap06_L_' + type],
    ['o_' + type, OT + '/mopsfin_t187ap06_O_' + type]
  ]))
};
export const disclosureUrls={L:TW+'/opendata/t187ap04_L',O:OT+'/mopsfin_t187ap04_O'};
export function companyDisclosures(feed,id,asOf) {
  if(!Array.isArray(feed))return {available:false,items:[]};
  const dates=feed.map(row=>asDate(row['發言日期'])).filter(date=>date&&date<=asOf).sort();
  const categories=[
    ['訂單／合約',/接獲訂單|新訂單|訂單|得標|承攬|簽訂.{0,10}(契約|合約)|長期供應|採購合約/],
    ['營運展望',/營運展望|法說會|法人說明會|展望|財務預測|營收指引|業績說明會/],
    ['產能／投資',/擴產|新廠|產能|資本支出|投資計畫|投產|量產/]
  ];
  const ordered=feed.flatMap(row=>{
    if(String(row['公司代號']??row.SecuritiesCompanyCode)!==id.slice(1))return [];
    const date=asDate(row['發言日期']);
    const title=String(row['主旨']??row['主旨 ']??'').replace(/\s+/g,' ').trim();
    if(!date||date>asOf||!title)return [];
    const time=String(row['發言時間']??'').padStart(6,'0');
    const label=categories.find(([,rule])=>rule.test(title))?.[0]??'其他重大訊息';
    return [{date,time,title,label,details:String(row['說明']??'').trim().slice(0,2600)}];
  }).sort((a,b)=>b.date.localeCompare(a.date)||b.time.localeCompare(a.time));
  const items=[...new Map(ordered.map(row=>[row.date+'/'+row.time+'/'+row.title,row])).values()];
  return {available:true,from:dates[0]??null,to:dates.at(-1)??null,items:items.slice(0,12),url:disclosureUrls[id[0]]};
}
export function compareIndustry(records,id) {
  const target=records?.[id];
  if(!target?.industryCode&&!target?.industry)return {count:0,rows:[],median:{}};
  const sector=record=>String(record.industryCode??'').trim().replace(/^0+(?=\d)/,'');
  const peers=Object.entries(records).filter(([key,record])=>key!==id&&ordinary(key.slice(1))&&
    (sector(record)&&sector(target)?sector(record)===sector(target):Boolean(target.industry&&record.industry===target.industry)));
  const align=([key,record])=>{
    const sameMonth=target.month&&record.month===target.month;
    const sameReport=target.period&&record.period===target.period;
    const sameValuation=target.valuationDate&&record.valuationDate===target.valuationDate;
    return {id:key,name:record.name,revenue:sameMonth?record.revenue:null,yoy:sameMonth?record.yoy:null,
      eps:sameReport?record.eps:null,grossMargin:sameReport?record.grossMargin:null,margin:sameReport?record.margin:null,
      pe:sameValuation&&record.pe>0?record.pe:null,pb:sameValuation&&record.pb>0?record.pb:null};
  };
  const rows=peers.map(align).filter(row=>['revenue','yoy','eps','grossMargin','margin','pe','pb'].some(key=>Number.isFinite(row[key])));
  const median={};
  for(const key of ['revenue','yoy','eps','grossMargin','margin','pe','pb']){
    const values=rows.map(row=>row[key]).filter(Number.isFinite).sort((a,b)=>a-b);
    const n=values.length,middle=Math.floor(n/2);
    if(n)median[key]={value:(values[middle]+values[Math.floor((n-1)/2)])/2,n};
  }
  const distance=row=>row.revenue>0&&target.revenue>0?Math.abs(Math.log(row.revenue/target.revenue)):Infinity;
  rows.sort((a,b)=>distance(a)-distance(b)||a.id.localeCompare(b.id));
  const byRevenue=rows.filter(row=>Number.isFinite(distance(row)));
  return {industry:target.industry??null,count:rows.length,target:align([id,target]),median,
    comparableRevenue:byRevenue.length>0,rows:(byRevenue.length?byRevenue:rows).slice(0,5)};
}
export async function jsonFetch(url, options = {}) {
  const r = await fetch(url, { headers:{Accept:'application/json','User-Agent':'TaiwanEquityLab/1.0'}, ...options, signal: AbortSignal.timeout(14000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
export async function tdccCsv() {
  const response=await fetch(TDCC,{signal:AbortSignal.timeout(14000)});
  if(!response.ok)throw new Error('TDCC HTTP '+response.status);
  return response.text();
}
function tdccBands(csv,asOf) {
  const holdings=new Map();
  if(typeof csv!=='string')return holdings;
  const [header,...lines]=csv.replace(/^\uFEFF/,'').split(/\r?\n/);
  if(!header.startsWith('資料日期,證券代號,持股分級,人數,'))return holdings;
  for(const line of lines){
    const [stamp,symbol,level,value,,share]=line.split(',');
    const code=symbol?.trim();
    if(!['1','12','13','14','15'].includes(level)||!ordinary(code))continue;
    const date=asDate(stamp);
    const count=num(value);
    if(!date||date>asOf||!Number.isInteger(count)||count<0)continue;
    if(!holdings.has(code)||holdings.get(code).date<date)holdings.set(code,{date,levels:{}});
    const record=holdings.get(code);
    if(record.date===date)record.levels[level]={count,share:num(share)};
  }
  return holdings;
}
export function tdccHolders(csv,asOf) {
  return new Map([...tdccBands(csv,asOf)].flatMap(([code,{date,levels}])=>
    levels[15]?[ [code,{date,count:levels[15].count}] ]:[]));
}
export function monthlyTradingUrl(day) {
  return 'https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK?date='+compact(day.slice(0,7)+'-01')+'&response=json';
}
export function listedTradingDates(report,day) {
  if(asDate(report?.date)!==day.slice(0,7)+'-01'||report.stat!=='OK'||!Array.isArray(report.data)||!report.data.length)return null;
  const dates=report.data.map(row=>asDate(row[0]));
  return dates.every(date=>date?.startsWith(day.slice(0,7)+'-'))?new Set(dates):null;
}
export async function fetchSources(urls, fetcher = jsonFetch) {
  const keys = Object.keys(urls);
  const result = {};
  const failed = [];
  for (let i = 0; i < keys.length; i += 6) {
    const group = keys.slice(i, i + 6);
    const values = await Promise.allSettled(group.map(key => fetcher(urls[key])));
    values.forEach((item, j) => {
      const k = group[j];
      if (item.status === 'fulfilled') result[k] = item.value;
      else failed.push(k + ' (' + item.reason.message + ')');
    });
  }
  return { result, failed };
}
const ordinary = (code) => /^[1-9]\d{3}$/.test(code) && !/^91/.test(code);
const table = (data, pred) => Array.isArray(data?.tables) ?
  data.tables.find(t => Array.isArray(t?.fields) && pred(t.fields,t.title??'')) : undefined;
const array = value => Array.isArray(value) ? value : [];
const quoteFields = {
  L:['證券代號','證券名稱','開盤價','最高價','最低價','收盤價','成交股數','成交金額','漲跌(+/-)','漲跌價差'],
  O:['代號','名稱','開盤','最高','最低','收盤','成交股數','成交金額(元)','漲跌','漲跌','次日漲停價','次日跌停價']
};
function projectQuotes(raw, market, date) {
  if (asDate(raw?.date)!==date) return [];
  const labels=quoteFields[market];
  const found=table(raw,f=>f[0]?.trim()===labels[0] && f.some(x=>x.trim()===labels[2]));
  if(!found)return [];
  const trimmed=found.fields.map(x=>x.trim());
  const at=labels.map(x=>trimmed.indexOf(x));
  if(at.slice(0,10).includes(-1))return [];
  return array(found.data).filter(Array.isArray).map(r=>at.map(i=>r[i]));
}
function projectFlow(raw, market, date) {
  if(asDate(raw?.date)!==date)return [];
  if(market==='L') {
    const labels=array(raw.fields);
    const match=[/外.*買賣超.*不含/,/^投信買賣超/,/^自營商買賣超股數$/, /自營商買賣超.*自行/, /自營商買賣超.*避險/];
    const at=match.map(re=>labels.findIndex(l=>re.test(l)));
    if(labels[0]!=='證券代號'||at.includes(-1))return [];
    return array(raw.data).filter(Array.isArray).map(r=>[r[0],...at.map(i=>num(r[i]))]);
  }
  const found=table(raw,(f,title)=> title.includes('三大法人買賣明細') && f.length>=24 &&
    f[0]==='代號' && f.at(-1).includes('合計') && [4,13,22,16,19].every(i=>f[i].includes('買賣超')));
  return array(found?.data).filter(Array.isArray).map(r=>[r[0],...[4,13,22,16,19].map(i=>num(r[i]))]);
}
const action = (sign, delta, close) => {
  const s = String(sign ?? '').replace(/<[^>]*>/g, '').trim();
  if (/[Xx除權息恢復]/.test(s)) return [true, null];
  const n = num(delta);
  if (n === null) return [false, null];
  return [false, close - (s === '-' ? -Math.abs(n) : n)];
};
export function normalizeDay(raw,date,{partial=false}={}) {
  const tw=projectQuotes(raw.tw,'L',date),ot=projectQuotes(raw.ot,'O',date);
  const tc=projectFlow(raw.tc,'L',date),oc=projectFlow(raw.oc,'O',date);
  const coverage={tw:tw.length,ot:ot.length,tc:tc.length,oc:oc.length};
  if (!partial && (coverage.tw<800 || coverage.ot<650)) return {day:null,coverage};
  const values = new Map();
  for (const [market, quotes, flows] of [['L', tw, tc], ['O', ot, oc]]) {
    const mapped=new Map(flows.map(([code,...chip])=>[String(code).trim(),chip]));
    for (const r of quotes) {
      const code = String(r[0]).trim();
      if (!ordinary(code)) continue;
      const [o,h,l,c,v,a]=r.slice(2,8).map(num);
      if (!(o>0 && c>0 && v>0 && a>0 && l>0 && l<=Math.min(o,c) && h>=Math.max(o,c))) continue;
      const [event,reference]=action(r[8],r[9],c);
      const chip=mapped.get(code)??[];
      const id = market + code;
      values.set(id,[id,o,h,l,c,v,a,...Array.from({length:5},(_,i)=>chip[i]??null),event?1:0,reference,
        String(r[1]??code).trim(),num(r[10]),num(r[11])]);
    }
  }
  const usable=[...values.keys()];
  coverage.listedRows=usable.filter(id=>id[0]==='L').length;
  coverage.otcRows=usable.length-coverage.listedRows;
  if(partial) {
    if(coverage.listedRows<650) for(const id of usable)if(id[0]==='L')values.delete(id);
    if(coverage.otcRows<500) for(const id of usable)if(id[0]==='O')values.delete(id);
  } else if(coverage.listedRows<650||coverage.otcRows<500) return {day:null,coverage};
  return { day: { date, coverage, rows: [...values.values()] }, coverage };
}
export function normalizeFundamentals(raw, asOf) {
  const records = {};
  const holders=tdccBands(raw.tdcc,asOf);
  for (const market of ['L', 'O']) {
    const p = market === 'L' ? 't' : 'o';
    const main = raw[p + 'm'];
    if (!Array.isArray(main)) continue;
    for (const r of main) {
      const code = r['公司代號'] ?? r.SecuritiesCompanyCode;
      if (!ordinary(code ?? '') || asDate(r['出表日期']??r.Date)>asOf) continue;
      records[market + code] = {
        name: r['公司簡稱'] ?? r.CompanyAbbreviation,
        industryCode: r['產業別'] ?? r.SecuritiesIndustryCode
      };
      const weekly=holders.get(code);
      if(weekly){
        const {date,levels}=weekly;
        const large=[12,13,14,15].map(level=>levels[level]);
        Object.assign(records[market+code],{
          holdersDate:date,holders1000:levels[15]?.count,holders15Pct:levels[15]?.share,
          smallHolders:levels[1]?.count,smallHoldersPct:levels[1]?.share,
          holders400:large.every(Boolean)?large.reduce((sum,level)=>sum+level.count,0):null,
          holders400Pct:large.every(level=>Number.isFinite(level?.share))?large.reduce((sum,level)=>sum+level.share,0):null
        });
      }
    }
    for (const r of array(raw[p + 'r'])) {
      const f = records[market + r['公司代號']];
      const released=asDate(r['出表日期']);
      if (!f || !released || released>asOf) continue;
      const month = String(r['資料年月'] ?? '');
      f.month = month.length === 5 ? (Number(month.slice(0, 3)) + 1911) + '-' + month.slice(3) : month;
      f.industry = r['產業別'];
      f.revenue = num(r['營業收入-當月營收']);
      f.yoy = num(r['營業收入-去年同月增減(%)']);
      f.monthlyMoM=num(r['營業收入-上月比較增減(%)']);
      f.priorMonthRevenue=num(r['營業收入-上月營收']);
      f.priorYearRevenue=num(r['營業收入-去年當月營收']);
      f.cumulativeRevenue=num(r['累計營業收入-當月累計營收']);
      f.cumulativeYoY=num(r['累計營業收入-前期比較增減(%)']);
    }
    for (const r of array(raw[p + 'v'])) {
      const date=asDate(r.Date);
      if (!date || date > asOf || date < shiftDate(asOf,-7)) continue;
      const f = records[market + (r.Code ?? r.SecuritiesCompanyCode)];
      if (!f || (f.valuationDate && f.valuationDate>date)) continue;
      f.valuationDate = date;
      f.pe = num(r.PEratio ?? r.PriceEarningRatio);
      f.pb = num(r.PBratio ?? r.PriceBookRatio);
      f.yield = num(r.DividendYield ?? r.YieldRatio);
    }
    for (const type of reportTypes) for (const r of array(raw[p + '_' + type])) {
      const f = records[market + (r['公司代號'] ?? r.SecuritiesCompanyCode)];
      const year = num(r['年度'] ?? r.Year);
      const q = num(r['季別'] ?? r.Season);
      const eps = num(r['基本每股盈餘（元）'] ?? r['基本每股盈餘(元)']);
      const released=asDate(r['出表日期']??r.Date);
      if (!f || !year || ![1,2,3,4].includes(q) || eps===null || !released || released>asOf) continue;
      const yearAD = year < 1911 ? year + 1911 : year;
      const period = yearAD + 'Q' + q;
      if (f.period && (f.period>period || f.period===period && f.reportDate>released)) continue;
      f.period = period;
      f.reportDate = released;
      f.eps = eps;
      f.profit = num(r['本期淨利（淨損）'] ?? r['本期淨利(淨損)']);
      const sales = num(r['營業收入']);
      const op = num(r['營業利益（損失）'] ?? r['營業利益(損失)']);
      const gross=num(r['營業毛利（毛損）淨額']??r['營業毛利（毛損）']);
      f.reportRevenue=sales;
      f.operatingProfit=op;
      f.margin = type === 'ci' && sales > 0 && op !== null ? op / sales * 100 : null;
      f.grossMargin=type==='ci'&&sales>0&&gross!==null?gross/sales*100:null;
      f.netMargin=type==='ci'&&sales>0&&f.profit!==null?f.profit/sales*100:null;
    }
  }
  return { asOf, records };
}
export function alignValuations(frame, days) {
  const asOf=frame?.asOf;
  const current=days.find(day=>day.date===asOf);
  if(!current)return frame;
  const byDate=new Map(days.map(day=>[day.date,new Map(day.rows.map(row=>[row[0],row]))]));
  const today=byDate.get(asOf);
  for(const [id,record] of Object.entries(frame.records)){
    const date=record.valuationDate;
    if(!date||date>=asOf)continue;
    const before=byDate.get(date)?.get(id), now=today.get(id);
    const between=days.filter(day=>day.date>date&&day.date<=asOf);
    const event=between.some(day=>{const row=byDate.get(day.date).get(id);return !row||row[12];});
    record.staleValuationDate=date;
    if(!(before?.[4]>0)||!(now?.[4]>0)||event){
      Object.assign(record,{pe:null,pb:null,yield:null,valuationDate:null});
      continue;
    }
    const ratio=now[4]/before[4];
    if(record.pe>0)record.pe*=ratio;
    if(record.pb>0)record.pb*=ratio;
    if(record.yield>0)record.yield/=ratio;
    record.valuationDate=asOf;
  }
  return frame;
}
export async function cashFlow(code, asOf) {
  const start = (Number(asOf.slice(0,4))-1) + '-12-31';
  const data = await jsonFetch('https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockCashFlowsStatement&data_id=' + code + '&start_date=' + start);
  const entries = Array.isArray(data.data) ? data.data.filter(r => r.date <= asOf) : [];
  const allowed = ['CashFlowsFromOperatingActivities','NetCashInflowFromOperatingActivities'];
  const item = entries.filter(r => allowed.includes(r.type)).sort((a,b)=>b.date.localeCompare(a.date) || allowed.indexOf(a.type)-allowed.indexOf(b.type))[0];
  if (!item || num(item.value) === null) return null;
  const capex = entries.find(r=>r.date===item.date && r.type==='PropertyAndPlantAndEquipment');
  const capexValue = num(capex?.value);
  return {
    date:item.date, ocf:Number(item.value)/1e6, capex:capexValue === null ? null : Math.abs(capexValue)/1e6,
    fcf:capexValue === null ? null : (Number(item.value)-Math.abs(capexValue))/1e6
  };
}
export async function finmindHistory(code,start,end) {
  const datasets={
    institutions:'TaiwanStockInstitutionalInvestorsBuySell',
    revenue:'TaiwanStockMonthRevenue', financials:'TaiwanStockFinancialStatements',
    cashFlow:'TaiwanStockCashFlowsStatement', valuation:'TaiwanStockPER'
  };
  const urls=Object.fromEntries(Object.entries(datasets).map(([key,dataset])=>[key,
    'https://api.finmindtrade.com/api/v4/data?'+new URLSearchParams({dataset,data_id:code,start_date:start,end_date:end})]));
  const {result,failed}=await fetchSources(urls);
  const series={};
  for(const key of Object.keys(datasets)){
    const response=result[key];
    if(!Array.isArray(response?.data)){
      if(response)failed.push(key+' (invalid dataset response)');
      series[key]=[];
    }else series[key]=response.data.filter(r=>String(r.stock_id)===code&&asDate(r.date)===r.date&&r.date>=start&&r.date<=end);
  }
  return {source:'FinMind',series,failed};
}
