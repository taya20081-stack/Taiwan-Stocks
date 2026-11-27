import { config, defaults, lookbackFor, ruleGroups, signalLabels, signalThresholds } from './model.js';
import { priceWindows } from './indicators.js';
import { E, f, int, pct, pn, market, short, average, statusText, heading, kpi, block, renderTable, chipAmount, scoreBreakdown, signalBadge, observationState } from './presentation.js';

const q=(s,root=document)=>root.querySelector(s);
const sections=['screen','rules','backtest','track','analysis','sources'];
const titles=['每日選股','策略規則','回測分析','推薦追蹤','個股分析','資料與方法'];
const select=(choices,value)=>choices.map(([id,label])=>'<option value="'+E(id)+'"'+(String(id)===String(value)?' selected':'')+'>'+E(label)+'</option>').join('');
let settings=config(defaults), status={}, screenData=null, tracking=null, backtest=null, tab='';
let observationPage=null,observationBefore='';
let notifyTimer;
async function api(path, data) {
  const r=await fetch('/api/'+path,data===undefined ? undefined : {
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)
  }).catch(()=>{throw new Error(navigator.onLine?'無法連線至資料服務，請稍後再試。':'目前離線，請重新連線後再試。');});
  const x=await r.json().catch(()=>({error:'資料服務暫時無法讀取。'}));
  if (!r.ok) throw new Error(x.error||'請稍後再試。');
  return x;
}
function note(text) {
  q('#toast').textContent=text;
  clearTimeout(notifyTimer);
  notifyTimer=setTimeout(()=>{q('#toast').textContent='';},4500);
}
function skeleton(text='正在讀取資料…') {return '<div class="empty">'+E(text)+'</div>';}
function stock(r,recommendationDate='') {
  return '<button type="button" class="stockbutton" data-stock="'+E(r.id)+'"'+
    (recommendationDate?' data-recommendation-date="'+E(recommendationDate)+'"':'')+'><span class="stockname">'+E(r.name ?? short(r.id))+'</span>'+
    '<span class="sub">'+E(short(r.id))+' · '+market(r.id)+'</span></button>';
}
function renderScreen(error='') {
  const d=screenData;
  const actions='<a class="secondary" id="export-html" href="/export.html">匯出 HTML</a>'+
    '<button type="button" class="secondary" id="search">查詢個股</button><button type="button" class="action" id="refresh">更新資料</button>';
  const headingHtml=heading('每日選股','從上市、上櫃普通股中尋找符合策略的候選。',actions);
  if (!d) {q('#screen').innerHTML=headingHtml+skeleton(error||undefined);return;}
  const p=d.rows.filter(x=>x.forecast?.prob!=null);
  const date=d.date??'—';
  const n=d.config?.limit ?? settings.limit;
  const state=d.frozen?'已保存當日推薦':d.frame?'研究預覽':'價量＋籌碼預覽';
  const info='<div class="state"><strong>'+E(state)+'</strong><div class="state-dates"><span>行情 '+E(date)+'</span>'+
    (d.fundamentalsDate?'<span>基本面 '+E(d.fundamentalsDate)+'</span>':'')+'</div></div>';
  const buy=d.rows.filter(r=>r.signal?.kind==='buy').length;
  const metrics='<div class="grid kpis daily-metrics">'+
    kpi('建議購入',int(buy)+' / '+n,'通過建倉、評分及預測門檻')+
    kpi('候選平均上漲機率',pct(average(p.map(x=>x.forecast.prob))),p.length?'有估計的候選 '+p.length+' 檔':'相似歷史樣本不足')+
    kpi('涵蓋股票',int(d.count),'上市＋上櫃普通股')+
    kpi('預測持有期',(d.config?.horizon ?? settings.horizon)+' 日','次一交易日開盤進場')+'</div>';
  const rows=d.rows.map(r=>[
    stock(r),'<strong>'+f(r.close,2)+'</strong><div class="sub '+pn(r.change)+'">'+pct(r.change,true)+'</div>',
    '<span class="badge green">'+f(r.score)+'</span>',
    scoreBreakdown(r),
    E(r.leader),'<strong>'+pct(r.forecast?.prob)+'</strong><div class="sub">'+
      (r.forecast?.prob!=null?E(r.forecast.basis)+' · n='+r.forecast.n:'樣本 '+(r.forecast?.n??0)+'</div>'),
    '<strong class="'+pn(r.forecast?.upside)+'">'+pct(r.forecast?.upside,true)+'</strong>',
    signalBadge(r.signal)
  ]);
  const main=block('候選名單','依綜合分數排序。主力建倉訊號依近 5 日法人買賣超推估。',
    rows.length?renderTable(['股票','收盤價','綜合分數','評分依據','5 日主要買超','預測上漲機率','預期價差','推薦訊號'],rows,'picks-table'):skeleton('目前沒有符合條件的候選。'));
  const h=status.historical;
  const hist=h?.first?h.first+' 至 '+h.last:status.days?status.start+' 起':'行情尚未匯入';
  const coverage=h?'<dl class="coverage"><div><dt>上市</dt><dd>價量 '+int(h.listed)+' 日 · 法人 '+int(h.listedFlows)+' 日</dd></div>'+
    '<div><dt>上櫃</dt><dd>價量 '+int(h.otc)+' 日 · 法人 '+int(h.otcFlows)+' 日</dd></div></dl>':'';
  const footer='<div class="grid two">'+block('資料覆蓋',hist,'<div class="card-body">'+coverage+
    '<p class="note">估值 '+int(d.valuation??0)+' 檔 · 本批現金流 '+int(d.cash??0)+' 檔。</p></div>')+
    block('預測與驗證','','<div class="card-body note">機率與漲幅依相似歷史訊號估計，採交易成本前的價差。樣本不足會保留空值。</div>')+'</div>';
  q('#screen').innerHTML=headingHtml+info+metrics+main+footer;
}
const numberField=(label,key,value,step='1',max='')=>'<label>'+E(label)+'<input type="number" inputmode="decimal" required name="'+key+'" min="0" '+(max?'max="'+max+'" ':'')+'step="'+step+'" value="'+E(value)+'"></label>';
const selector=(label,key,choices,value)=>'<label>'+E(label)+'<select name="'+key+'">'+select(choices,value)+'</select></label>';
const opChoices=[['gte','≥'],['gt','>'],['lte','≤'],['lt','<'],['eq','=']];
const groupOptions=Object.entries(ruleGroups).map(([id,group])=>[id,group.label]);
const groupForField=field=>Object.keys(ruleGroups).find(id=>Object.hasOwn(ruleGroups[id].fields,field))??'technical';
const normalizeQuery=value=>value.normalize('NFKC').toLocaleLowerCase('zh-TW');
function indicatorOptions(group,field,query='') {
  const terms=normalizeQuery(query).trim().split(/\s+/).filter(Boolean);
  const searching=terms.length>0;
  const groups=searching?Object.entries(ruleGroups):[[group,ruleGroups[group]]];
  let count=0;
  let containsSelection=false;
  let options='';
  for(const [,item] of groups){
    for(const [section,fields] of Object.entries(item.sections)){
      const matches=Object.entries(fields).filter(([key,label])=>{
        const text=normalizeQuery([key,item.label,section,label].join(' '));
        return terms.every(term=>text.includes(term));
      });
      if(!matches.length)continue;
      count+=matches.length;
      containsSelection ||= matches.some(([key])=>key===field);
      options+='<optgroup label="'+E(searching?item.label+' · '+section:section)+'">'+select(matches,field)+'</optgroup>';
    }
  }
  if(searching&&!containsSelection&&field){
    const selected=ruleGroups[groupForField(field)].fields[field];
    options=select([[field,selected+'（目前選擇）']],field)+options;
  }
  if(searching&&!count)options+='<option disabled>找不到符合的指標</option>';
  return {options,status:searching?(count?'找到 '+count+' 項指標':'找不到符合的指標。'):''};
}
function ruleRow(r={field:'k9',op:'gte',value:''}) {
  const group=groupForField(r.field);
  return '<div class="rule">'+selector('面向','ruleGroup',groupOptions,group)+
    '<label class="rule-query">搜尋指標<input type="search" name="ruleQuery" placeholder="例如 RSI、外資、營收">'+
    '<span class="rule-query-status" role="status"></span></label>'+
    '<label class="rule-indicator">指標<select name="ruleField">'+indicatorOptions(group,r.field).options+'</select></label>'+
    selector('比較','ruleOp',opChoices,r.op)+'<label>門檻<input type="number" inputmode="decimal" name="ruleValue" required step="any" value="'+E(r.value)+'"></label>'+
    '<button type="button" class="secondary remove-rule">移除</button></div>';
}
function renderRules(values=settings) {
  q('#rules').innerHTML=heading('策略規則','調整選股門檻、因子權重、持有天數和交易成本。')+
    '<form id="settings" autocomplete="off">'+block('選股設定','',
      '<div class="card-body form-grid">'+selector('交易市場','market',[['all','上市＋上櫃'],['L','上市'],['O','上櫃']],values.market)+
        selector('每日候選上限','limit',[[3,'3 檔'],[4,'4 檔'],[5,'5 檔']],values.limit)+
        numberField('最低綜合分數','score',values.score,'.1','100')+numberField('20 日均成交額下限（百萬元）','amount',values.amount,'.1')+
      '</div>')+
    block('因子權重','權重可填 0 至 100。系統以三項加總換算相對比重。',
      '<div class="card-body form-grid three">'+numberField('技術面','tech',values.tech,'.1','100')+numberField('基本面','fund',values.fund,'.1','100')+numberField('籌碼面','chip',values.chip,'.1','100')+'</div>')+
    block('自訂條件','先選面向，再選指標。所有條件須同時成立，缺少指標資料的股票會被排除。',
      '<div class="card-body"><div id="rule-list">'+values.rules.map(ruleRow).join('')+'</div><button class="secondary" type="button" id="add-rule">新增條件</button></div>')+
    block('進出場與成本','以次一交易日開盤進場。持有第 N 個交易日收盤出場。',
      '<div class="card-body form-grid">'+selector('持有交易日','horizon',[1,3,5,10,20].map(x=>[x,x+' 日']),values.horizon)+
        numberField('單邊手續費（%）','fee',values.fee,'any','5')+numberField('賣出交易稅（%）','tax',values.tax,'any','5')+
        numberField('單邊滑價（%）','slip',values.slip,'any','5')+'</div>')+
    '<div class="controls form-actions"><button class="action" type="submit">儲存策略</button><button type="button" id="reset" class="secondary">還原預設值</button></div>'+
    '<p id="settings-feedback" class="feedback" role="status"></p><p class="note">儲存後套用於下一份推薦與回測。</p></form>';
}
let dates = {start:'',end:'',mode:'baseline',settle:'bounded'};
let resultPage=0;
const resultsPerPage=12;
function renderBacktest() {
  q('#backtest').innerHTML=heading('回測分析','用歷史行情模擬選股，檢查逐筆勝率與成本後報酬。')+
    block('回測參數','使用「策略規則」中已儲存的設定。',
      '<div class="card-body"><p id="available-dates" class="available-dates"></p><form id="test-form" autocomplete="off"><div class="form-grid backtest-fields">'+
        selector('資料模式','mode',[['baseline','價量＋籌碼'],['technical','僅價量'],['full','技術＋基本＋籌碼']],dates.mode)+
        '<label>訊號起日<input type="date" name="start" value="'+E(dates.start)+'"></label>'+
        '<label>訊號迄日<input type="date" name="end" value="'+E(dates.end)+'"></label>'+
        selector('結算範圍','settle',[['bounded','截至訊號迄日'],['unbounded','納入迄日後行情']],dates.settle)+'</div>'+
        '<div class="controls form-actions"><button class="action" type="submit">執行回測</button><a class="secondary" href="#rules">修改規則</a></div>'+
        '<p id="backtest-feedback" class="feedback" role="status"></p></form></div>')+
    '<div id="results"></div>';
  showAvailableDates();
  showBacktest();
}
function showAvailableDates() {
  const label=q('#available-dates');
  const h=status.historical;
  if(label)label.textContent=h?.first?'資料區間 '+h.first+' 至 '+h.last+'。各市場及因子涵蓋日數見每日選股。':'';
}
function chart(values, zero, format) {
  if (values.length<2) return '<div class="empty">資料累積後會顯示圖表。</div>';
  const width=700,height=205,pad=22;
  const series = values.map(p=>p.value);
  const floor=Math.min(...series,...(zero?[0]:[])), ceiling=Math.max(...series,...(zero?[0]:[]));
  const spread=ceiling-floor||1;
  const x=i=>pad+i/(values.length-1)*(width-2*pad);
  const y=v=>height-pad-(v-floor)/spread*(height-2*pad);
  const points=values.map((p,i)=>x(i)+','+y(p.value)).join(' ');
  const svg='<svg viewBox="0 0 '+width+' '+height+'" role="img" aria-label="從 '+E(values[0].date)+' 至 '+E(values.at(-1).date)+'，最低 '+E(format(floor))+'，最高 '+E(format(ceiling))+'">'+
    [floor,(floor+ceiling)/2,ceiling].map(v=>'<line x1="'+pad+'" x2="'+(width-pad)+'" y1="'+y(v)+'" y2="'+y(v)+'" stroke="#dfe5ed" stroke-dasharray="3 4"/>').join('')+
    (zero?'<line x1="'+pad+'" x2="'+(width-pad)+'" y1="'+y(0)+'" y2="'+y(0)+'" stroke="#acb9c8"/>':'')+
    '<polyline points="'+points+'" fill="none" stroke="#087561" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>'+
    '<circle cx="'+x(values.length-1)+'" cy="'+y(values.at(-1).value)+'" r="4" fill="#087561"/></svg>';
  return '<div class="chart">'+svg+'</div><div class="chart-meta sub"><span>'+E(values[0].date)+'</span><span>'+E(values.at(-1).date)+'</span></div>'+
    '<div class="chart-meta sub" aria-hidden="true"><span>最低 '+E(format(floor))+'</span><span>最高 '+E(format(ceiling))+'</span></div>';
}
function resultList(rows,subtitle) {
  if(!rows.length)return block('逐筆紀錄',subtitle,skeleton('這段期間沒有可依該設定回測的訊號。'));
  const first=resultPage*resultsPerPage;
  const last=Math.min(first+resultsPerPage,rows.length);
  const pages=rows.length>resultsPerPage?'<div class="pagination"><button class="secondary" type="button" data-result-step="-1"'+
    (!first?' disabled':'')+'>上一頁</button><span role="status">'+(first+1)+'–'+last+' / '+rows.length+'</span>'+
    '<button class="secondary" type="button" data-result-step="1"'+(last===rows.length?' disabled':'')+'>下一頁</button></div>':'';
  const detail=renderTable(['訊號日','股票','進場日','出場日','毛報酬','淨報酬','交易狀態'],
    rows.slice(rows.length-last,rows.length-first).reverse().map(r=>[E(r.date),stock(r),E(r.entry??'—'),E(r.exit??'—'),
      '<span class="'+pn(r.gross)+'">'+pct(r.gross,true)+'</span>','<span class="'+pn(r.net)+'">'+pct(r.net,true)+'</span>',E(statusText[r.status])]),'records-table');
  return block('逐筆紀錄',subtitle,detail+pages,'<button type="button" class="secondary" id="csv">匯出 CSV</button>','result-list-title');
}
function resultSubtitle({mode,coverage}) {
  if(mode==='full')return '使用 '+coverage.frameCount+' 個交易日的基本面快照。';
  const label=mode==='technical'?'價量':'價量＋籌碼';
  return label+'歷史樣本，使用前 '+lookbackFor(settings)+' 個交易日計算指標。';
}
function showBacktest() {
  const el=q('#results');
  if (!el) return;
  if (!backtest) {el.innerHTML=skeleton('選擇日期範圍後執行回測。未填日期時使用全部可用交易日。');return;}
  const {rows,daily}=backtest;
  const done=rows.filter(r=>r.status==='done');
  const excluded=rows.length-done.length;
  const subtitle=resultSubtitle(backtest);
  const metrics='<div class="grid kpis">'+kpi('成本後勝率',pct(average(done.map(r=>r.net>0?100:0))),'成本後報酬大於 0')+
    kpi('平均單筆淨報酬',pct(average(done.map(r=>r.net)),true),'含手續費、賣出稅與滑價')+
    kpi('完成交易',int(done.length),'另有 '+excluded+' 筆未結算或排除')+
    kpi('有效訊號日',int(daily.length),subtitle)+'</div>';
  el.innerHTML='<h2 id="result-title" tabindex="-1" class="result-title">回測結果</h2>'+metrics+block('每日訊號平均淨報酬','以同一訊號日的已結算個股等權平均。',
    '<div class="card-body">'+chart(daily.map(p=>({date:p.date,value:p.net})),true,v=>pct(v,true))+'</div>')+
    '<div id="result-list">'+resultList(rows,subtitle)+'</div>';
}
function renderTrack(error='') {
  const section=q('#track-trades');
  if (error||!tracking) {section.innerHTML=skeleton(error||undefined);return;}
  const {summary:s,joined,logs,next}=tracking;
  const metrics='<div class="grid kpis">'+kpi('已保存推薦',int(s.total),'最近 '+logs.length+' 份交易日紀錄')+
    kpi('已結算',int(s.done),'等待進場、持有及排除細節見下表')+
    kpi('實際淨勝率',pct(s.win),'已完成且成本後為正')+
    kpi('平均實際淨報酬',pct(s.net,true),'每筆等權平均')+'</div>';
  const rows=joined.map(r=>[E(r.date),stock(r,r.date),int(r.horizon)+' 日',pct(r.forecast?.prob),pct(r.forecast?.upside,true),
    E(r.exit??'—'),'<span class="'+pn(r.gross)+'">'+pct(r.gross,true)+'</span>','<span class="'+pn(r.net)+'">'+pct(r.net,true)+'</span>',
    signalBadge(r.signal,true),E(statusText[r.status])]);
  const stats=s.forecastCount?'有預測且已結算 '+s.forecastCount+' 筆 · 機率 Brier 分數 '+f(s.brier,3)+' · 漲幅平均絕對誤差 '+f(s.mae,2)+' 個百分點':'預測誤差統計會在有預測值的推薦結算後開始顯示。';
  section.innerHTML=metrics+block('持有期交易明細',stats,
    rows.length?renderTable(['推薦日','股票','持有期','預測上漲機率','預期價差','結算日','實際毛報酬','實際淨報酬','推薦訊號','交易狀態'],rows,'records-table'):
      skeleton(logs.length?'已保存的交易日沒有符合條件的候選。':'收盤資料更新並保存推薦後，會從網站上線日開始建立追蹤紀錄。'))+
    (next?'<button class="secondary" type="button" id="older" data-before="'+E(next)+'">較早紀錄</button>':'')+
    (trackBefore?'<button class="secondary" type="button" id="latest-track">最近紀錄</button>':'');
}
function observedReturn(point) {
  return point?'<span class="'+pn(point.value)+'">'+pct(point.value,true)+'</span><div class="sub">'+E(point.date)+'</div>':'—';
}
function renderObservations(error='') {
  const section=q('#track-90');
  if(error||!observationPage){section.innerHTML=block('90 天觀察紀錄','',skeleton(error||undefined));return;}
  const {rows,groups,next,asOf}=observationPage;
  const compare=groups.length?renderTable(['模型版本','推薦訊號','滿 90 天樣本','上漲比率','平均價差'],
    groups.map(g=>[E(g.version),E(signalLabels[g.signal]??signalLabels.unknown),int(g.n),pct(g.win),pct(g.average,true)]),'records-table'):
    skeleton('滿 90 天且行情可核對的樣本會列入這裡。');
  const detail=rows.map((r,i)=>[
    E(r.date),'<button class="stockbutton" type="button" data-observation="'+i+'"><span class="stockname">'+E(r.name??short(r.id))+
      '</span><span class="sub">'+E(short(r.id))+' · 查看走勢</span></button>',
    signalBadge(r.signal),E(observationState[r.state]??'待核對'),observedReturn(r.latest),...([30,60,90].map(n=>observedReturn(r.checkpoints[n]))),
    '<span class="'+pn(r.high)+'">'+pct(r.high,true)+'</span> ／ <span class="'+pn(r.low)+'">'+pct(r.low,true)+'</span>'
  ]);
  section.innerHTML=block('90 天觀察紀錄','以次一交易日開盤價為起點，追蹤 90 個日曆日。'+(asOf?' 行情更新至 '+asOf+'。':''),
    detail.length?renderTable(['推薦日','股票','推薦訊號','觀察進度','最近價差','30 天','60 天','90 天','收盤高／低點'],detail,'records-table'):
      skeleton('每日推薦存檔後，會自動加入長期觀察。'))+
    '<div class="controls">'+
    (next?'<button class="secondary" type="button" data-observations-before="'+E(next)+'">較早觀察</button>':'')+
    (observationBefore?'<button class="secondary" type="button" data-observations-before="">最近觀察</button>':'')+'</div>'+
    block('按模型版本與推薦訊號比較','以可核對的 90 天收盤價差統計，未扣交易成本。',compare,
      '<a href="#rules" class="secondary">查看策略</a>');
}
async function getObservations(before='') {
  try{
    observationPage=await api('observations'+(before?'?before='+encodeURIComponent(before):''));
    observationBefore=before;
    renderObservations();
  }catch(e){renderObservations(e.message);}
}
function showObservation(row,button) {
  const note=row.issueDate?observationState[row.state]+' · '+row.issueDate:'預計觀察至 '+row.end;
  const values=row.points;
  const graph=values.length>1?chart(values,true,value=>pct(value,true)):
    skeleton(values.length?values[0].date+' · '+pct(values[0].value,true):'等待首筆可核對的盤後行情。');
  modalSet((row.name??short(row.id))+' · 90 天觀察',
    block('推薦訊號',row.date,'<div class="card-body">'+signalBadge(row.signal,true)+'</div>')+'<p class="sub">'+E(note)+'</p>'+graph,button);
}
function renderSources() {
  const item=(name,desc,url)=>'<div class="source"><a href="'+url+'" target="_blank" rel="noopener">'+E(name)+'</a><p class="note">'+E(desc)+'</p></div>';
  q('#sources').innerHTML=heading('資料與方法','查閱評分口徑、資料來源及歷史覆蓋。')+
    block('資料來源','','<div class="card-body">'+
      item('臺灣證券交易所','上市行情、估值、法人買賣超及財務摘要。','https://openapi.twse.com.tw/')+
      item('證券櫃檯買賣中心','上櫃行情、估值與外資、投信和自營商買賣明細。','https://www.tpex.org.tw/openapi/')+
      item('公開資訊觀測站','公開申報的月營收與財務報表。','https://mops.twse.com.tw/')+
      item('臺灣集中保管結算所','千張大戶取集保戶股權分散表第 15 級，每週更新，以資料日期為準。','https://www.tdcc.com.tw/portal/zh/smWeb/qryStock')+
      item('FinMind','個股營業活動淨現金流及資本支出。每日預先查詢候選附近的股票，個股頁可另查。','https://finmind.github.io/tutor/TaiwanMarket/Fundamental/')+
      item('TradingView 技術指標目錄','參考趨勢、震盪、波動及量價指標名稱。研究台使用台股日線資料計算。','https://tradingview.com/charting-library-docs/latest/ui_elements/indicators/Indicators-List/')+
      item('歷史日行情封存','以公開的交易所行情封存回補缺口，核對資料包與檔案雜湊。','https://github.com/nanachi1212/TWstockfor_tick-stock-panel/releases')+
      item('法人歷史封存','補入可核對交易日期與買賣超欄位的交易所法人紀錄。','https://github.com/twcs-analysis/tw-stock-collector/tree/main/data/raw/institutional')+
    '</div>')+
    block('評分與驗證','','<div class="card-body"><ul>'+
      '<li>技術分數中，20 日動能占 50%，MA20 均線乖離占 35%，量價方向占 15%。KD 使用 9 日高低價、從 50 起算的 K、D 平滑值，保留 50 根日 K 線進行計算。</li>'+
      '<li>基本面分數使用月營收年增率、財報 EPS、本益比和營業現金流，原始權重依序為 40%、25%、20%、15%。至少須有兩項資料，依可用項目的權重計算。獲利及正現金流加分，正本益比越低，估值分數越高。估值資料若早於行情日，本益比、淨值比與殖利率依兩日收盤價比例換算到行情日；期間遇除權息或缺價則不採用。加分與減分以 50 分為中性基準。</li>'+
      '<li>籌碼分數使用最近 5 日外資、投信與自營商自行買賣的淨額占成交股數比，以 50＋50×tanh（占比÷20）換算，占比 +10% 約 73 分、+30% 約 95 分，不會在單一門檻封頂。明細另列避險淨額。類別淨買超反映買盤來源，無法確認券商分點、帳戶或實際建倉。</li>'+
      '<li>主力建倉訊號要求三類法人合計近 5 日至少 '+signalThresholds.flowDays+' 日淨買超，累計淨買超占成交量達 '+signalThresholds.flow+'%。籌碼賣壓用同一門檻判斷淨賣超。達建倉條件、技術分數達 '+signalThresholds.tech+'、綜合分數達 '+signalThresholds.score+'、模型上漲機率達 '+signalThresholds.probability+'% 且預期價差高於策略交易成本，標示「建議購入」。</li>'+
      '<li>每日選股、推薦追蹤的持有期交易與 90 天觀察使用推薦當日的訊號。法人買賣超未達門檻時標示「觀察」，當日資料缺少或無法核對時標示「資料待核對」。交易狀態與觀察進度依後續行情更新。</li>'+
      '<li>唐奇安通道使用訊號日前 20 個交易日的最高與最低價。歷史波動率依 20 日對數報酬，以一年 252 個交易日年化。OBV 顯示 20 日變化量，CMF 以百分比表示。</li>'+
      '<li>預測用同市場、分數相差 10 分內的已結算歷史訊號。至少需要 30 筆、10 個訊號日。上漲機率以正毛報酬頻率平滑估計，預期價差取平均毛報酬。</li>'+
    '<li>回測勝率為成本後報酬大於零的已結算筆數比例。缺價、公司行動、交易日待核對與鎖漲跌停各自標記。價格限制按交易所跳動單位判定。</li>'+
      '<li>訊號的持有期可以重疊。驗證策略時，可先在早期區間設定規則，再以後續日期回測並選擇「截至訊號迄日」。</li>'+
      '<li>回補範圍限上市與上櫃普通股。只有具備當日基本面快照的交易日可用於三面向回測。盤後每週一至週五 18:30（台灣時間）排程更新。</li>'+
    '</ul></div>')+
    block('相關 Skills','','<div class="card-body">'+
      item('FinLab AI Skill','台股資料、選股條件與策略績效回測。','https://finlab.finance/agents')+
      item('TWMD Skills','法人流向、估值與多因子研究及回測範例。','https://twmarketdata.com/zh-TW/docs/ai-agents/skills')+
      item('FinMind Agent Skill','自然語言取得台股價量、籌碼、基本面和估值。','https://finmind.github.io/tutor/ai/AgentSkill/')+
    '</div>');
}
function analysisNotes(items) {
  return items.length?'<ul class="analysis-notes">'+items.map(item=>'<li>'+E(item)+'</li>').join('')+'</ul>':'';
}
function analysisSummary(report) {
  const d=report.info??{},v=report.indicators,o=report.ownership;
  const close=report.history.at(-1).close;
  const tags=[];
  if(Number.isFinite(d.yoy))tags.push(d.yoy>0?'月營收年增':d.yoy<0?'月營收年減':'月營收持平');
  if(Number.isFinite(v.ma20))tags.push(close>v.ma20?'收盤在 20 日均線之上':close<v.ma20?'收盤在 20 日均線之下':'收盤接近 20 日均線');
  if(Number.isFinite(o.chipRatio))tags.push(o.chipRatio>0?'近 5 日法人合計淨買超':o.chipRatio<0?'近 5 日法人合計淨賣超':'近 5 日法人合計淨額持平');
  const risks=[];
  if(d.eps>0&&report.cash?.ocf<0)risks.push('已公布的 EPS 為正，累計營業現金流為負，需核對財報與營運資金。');
  if(v.rsi14>=70&&o.chipRatio<0)risks.push('RSI 處於常用超買區，近 5 日法人合計淨賣超，留意價量與籌碼分歧。');
  const event=report.disclosures.items.find(item=>item.label!=='其他重大訊息');
  if(event)risks.push('可查閱的近期營運訊息為 '+event.date+'「'+event.title+'」。');
  return block('研究摘要',tags.join(' · ')||'現有資料不足以概括三面向。',
    risks.length?'<div class="card-body">'+analysisNotes(risks)+'</div>':'');
}
function analysisFundamentals(d,c,peers) {
  const values=[
    ['月營收',Number.isFinite(d.revenue)?f(d.revenue/1000)+' 百萬元':'—',d.month],
    ['月營收年增／月增',pct(d.yoy,true)+' ／ '+pct(d.monthlyMoM,true),d.month],
    ['累計營收年增',pct(d.cumulativeYoY,true),d.month],['財報 EPS',f(d.eps,2),d.period],
    ['毛利率／營益率',pct(d.grossMargin)+' ／ '+pct(d.margin),d.period],['淨利率',pct(d.netMargin),d.period],
    ['本益比／股價淨值比',f(d.pe,1)+' ／ '+f(d.pb,1),d.valuationDate],['現金殖利率',pct(d.yield),d.valuationDate],
    ['營業現金流',Number.isFinite(c.ocf)?int(c.ocf)+' 百萬元':'—',c.date?c.date+' · 累計':''],
    ['自由現金流',Number.isFinite(c.fcf)?int(c.fcf)+' 百萬元':'—',c.date?c.date+' · 累計':'']
  ];
  const points=[];
  if(Number.isFinite(d.yoy))points.push('月營收年增率為 '+pct(d.yoy,true)+(Number.isFinite(peers.median.yoy?.value)?'，較同業中位數 '+pct(peers.median.yoy.value,true)+' '+(d.yoy>peers.median.yoy.value?'高':d.yoy<peers.median.yoy.value?'低':'持平')+'。':'。'));
  if(Number.isFinite(d.eps))points.push(d.period+' 每股'+(d.eps>=0?'盈餘 ':'虧損 ')+f(Math.abs(d.eps),2)+' 元。'+(Number.isFinite(c.ocf)?'已公布的累計營業現金流為 '+int(c.ocf)+' 百萬元。':''));
  if(d.pe>0&&peers.median.pe?.value>0)points.push('本益比 '+f(d.pe,1)+' 倍，同業中位數為 '+f(peers.median.pe.value,1)+' 倍，估值相對差幅 '+pct(100*(d.pe/peers.median.pe.value-1),true)+'。');
  return block('基本面','營收、獲利、現金流與估值各按揭露期間顯示。',
    '<div class="card-body">'+analysisNotes(points)+'<div class="grid kpis">'+values.map(v=>kpi(...v)).join('')+'</div></div>');
}
function analysisTechnique(info) {
  const v=info.indicators;
  const last=info.history.at(-1);
  const points=[];
  if(Number.isFinite(v.ma20)&&v.ma20>0)points.push('收盤 '+f(last.close,2)+' 元，距 20 日均線 '+pct(100*(last.close/v.ma20-1),true)+'。'+(Number.isFinite(v.ma60)?'20 日與 60 日均線分別為 '+f(v.ma20,2)+' 與 '+f(v.ma60,2)+' 元。':''));
  if(Number.isFinite(v.adx14)&&Number.isFinite(v.plusDi14)&&Number.isFinite(v.minusDi14))points.push('ADX '+f(v.adx14,1)+'，'+(v.adx14>=25?'趨勢強度達到常用的 25 門檻':'趨勢強度低於常用的 25 門檻')+'。'+(v.plusDi14>v.minusDi14?'+DI 高於 −DI，方向偏多。':v.plusDi14<v.minusDi14?'−DI 高於 +DI，方向偏空。':'正負方向指標持平。'));
  if(Number.isFinite(v.rsi14))points.push('RSI '+f(v.rsi14,1)+'，'+(v.rsi14>=70?'達常用超買區':v.rsi14<=30?'達常用超賣區':'介於常用超賣與超買門檻之間')+'。'+(Number.isFinite(v.macdHistogram)?'MACD 柱狀差為 '+f(v.macdHistogram,2)+'。':''));
  if(Number.isFinite(v.donchianHigh20)&&Number.isFinite(v.donchianLow20))points.push('前 20 日價格區間 '+f(v.donchianLow20,2)+'–'+f(v.donchianHigh20,2)+' 元。'+(Number.isFinite(v.atr14Pct)?'14 日 ATR 占收盤價 '+pct(v.atr14Pct)+'。':''));
  if(v.averageVolume20>0&&Number.isFinite(last.volume))points.push('當日成交量 '+int(last.volume/1000)+' 張，為 20 日均量的 '+f(last.volume/1000/v.averageVolume20,2)+' 倍。');
  return block('技術面','行情截至 '+last.date+'。',
    '<div class="card-body">'+analysisNotes(points)+chart(info.history.map(row=>({date:row.date,value:row.close})),false,value=>f(value,2))+'</div>')+stockIndicators(v,last.date);
}
function analysisOwnership(info) {
  const o=info.ownership,d=info.info??{};
  const lines=[['外資',o.foreign,o.foreign20],['投信',o.trust,o.trust20],['自營商自行買賣',o.active,o.active20],['自營商避險',o.hedge,null]];
  const points=[];
  if(Number.isFinite(o.chipRatio))points.push('近 5 個交易日三類法人合計淨買超 '+(o.buyDays??'—')+' 日、淨賣超 '+(o.sellDays??'—')+' 日，淨額占同期成交量 '+pct(o.chipRatio,true)+'。');
  if(Number.isFinite(d.holders1000))points.push((d.holdersDate??'最近集保週資料')+' 的千張大戶有 '+int(d.holders1000)+' 人'+(Number.isFinite(d.holders15Pct)?'，持股占 '+pct(d.holders15Pct):'')+'。');
  return block('籌碼面','法人資料以 '+info.history.at(-1).date+' 為觀察終點。',
    '<div class="card-body">'+analysisNotes(points)+'<p class="note">買賣超反映各類法人公開淨額，可用於觀察買盤集中度。</p></div>'+
    renderTable(['類別','近 5 日','近 20 日'],lines.map(([name,a,b])=>[E(name),E(chipAmount(a)),E(chipAmount(b))]),'analysis-table'));
}
function industryAnalysis(info) {
  const p=info.peers;
  if(!p.count)return block('同業比較','','<div class="card-body">'+skeleton('沒有相同產業、相同期間的可比較資料。')+'</div>');
  const target=info.info??{};
  const fields=[['月營收年增','yoy',pct],['財報 EPS','eps',number=>f(number,2)],['毛利率','grossMargin',pct],
    ['營益率','margin',pct],['本益比','pe',number=>f(number,1)],['股價淨值比','pb',number=>f(number,1)]];
  const benchmark=fields.map(([label,key,format])=>[E(label),format(p.target[key]),format(p.median[key]?.value),int(p.median[key]?.n)]);
  const peerRows=p.rows.map(row=>['<a href="#analysis/'+E(row.id)+'">'+E((row.name??short(row.id))+' '+short(row.id))+'</a>',pct(row.yoy,true),f(row.eps,2),pct(row.margin),f(row.pe,1)]);
  return block('同業比較',(p.industry??'交易所產業分類')+' · '+p.count+' 家具有可比資料的上市、上櫃同業',
    '<div class="card-body note">月營收 '+E(target.month??'—')+'、財報 '+E(target.period??'—')+'、估值 '+E(target.valuationDate??'—')+'。同一期間才納入各項中位數。</div>'+
    renderTable(['指標','個股','同業中位數','同業樣本'],benchmark,'analysis-table')+
    '<div class="card-body"><h3>'+(p.comparableRevenue?'營收規模接近的同業':'同產業公司')+'</h3></div>'+
    renderTable(['股票','月營收年增','財報 EPS','營益率','本益比'],peerRows,'analysis-table'));
}
function disclosureAnalysis(report) {
  const d=report.disclosures;
  const relevant=d.items.filter(item=>item.label!=='其他重大訊息');
  const other=d.items.filter(item=>item.label==='其他重大訊息');
  const item=row=>'<details class="indicator-panel disclosure"><summary>'+E(row.date+' · '+row.label+' · '+row.title)+'</summary>'+
    '<p>'+E(row.details||'來源只提供公告主旨。')+'</p></details>';
  const message=!d.available?'交易所公告來源暫時無法讀取。':!relevant.length?'本次查到的公告範圍內，沒有可核對的訂單、產能或展望更新。':'';
  const period=d.from&&d.to?'目前取得的交易所公告日期為 '+d.from+' 至 '+d.to+'。':'依可取得的交易所近期公告整理。';
  return block('訂單與營運展望',period,'<div class="card-body">'+
    (message?'<p class="note">'+E(message)+'</p>':'')+relevant.map(item).join('')+
    (other.length?'<h3 class="analysis-subtitle">其他近期公告</h3>'+other.map(item).join(''):'')+
    '<p class="note">合約、公司展望與產能規劃依公司公告顯示。訂單金額與時程以實際揭露為準。</p>'+
    '<div class="controls source"><a href="https://mops.twse.com.tw/mops/web/t05st01" target="_blank" rel="noopener">歷史重大訊息</a><a href="https://mops.twse.com.tw/mops/web/t100sb02_1" target="_blank" rel="noopener">法人說明會資料</a></div></div>');
}
function renderAnalysis(data,code='',error='') {
  const lookup='<form id="analysis-lookup" class="card-body form-grid three lookup-fields" autocomplete="off">'+
    selector('市場','market',[['L','上市'],['O','上櫃']],code[0]??'L')+
    '<label>股票代碼<input name="code" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" placeholder="例如 2330" required value="'+E(code.slice(1))+'"></label>'+
    '<div class="controls"><button class="action" type="submit">分析個股</button></div></form>';
  q('#analysis').innerHTML=heading('個股分析','查詢上市、上櫃普通股的基本面、技術面、籌碼與公開營運動態。')+
    block('查詢股票','',lookup)+'<div id="analysis-report" aria-live="polite">'+(data?
      block(data.name+' '+short(data.id)+' · '+market(data.id),(data.info?.industry??'')+' · 最新行情 '+data.history.at(-1).date+
        (data.asOf?' · 公司資料 '+data.asOf:'')+(data.marketAsOf!==data.history.at(-1).date?' · 市場行情已至 '+data.marketAsOf:''),'',undefined,'analysis-title')+
      analysisSummary(data)+analysisFundamentals(data.info??{},data.cash??{},data.peers)+industryAnalysis(data)+analysisTechnique(data)+
      analysisOwnership(data)+disclosureAnalysis(data):skeleton(error||(code?'正在整理個股資料…':'輸入股票代碼開始分析。')))+'</div>';
}
let analysisRequest=0;
let analysisCode='';
async function getAnalysis(code) {
  const token=++analysisRequest;
  analysisCode=code;
  renderAnalysis(null,code);
  if(!code)return;
  try{
    const data=await api('analysis?id='+encodeURIComponent(code));
    if(token===analysisRequest){renderAnalysis(data,code);if(tab==='analysis')q('#analysis-title').focus({preventScroll:true});}
  }catch(error){if(token===analysisRequest)renderAnalysis(null,code,error.message);}
}
async function getScreen() {
  try {
    [status,screenData]=await Promise.all([api('status'),api('picks')]);
    q('#clock').textContent='臺北時間 · '+(status.today||'台灣交易日');
    renderScreen();
    showAvailableDates();
  } catch(e) {renderScreen(e.message);}
}
let trackBefore='';
async function getTrack(before='') {
  try {tracking=await api('track'+(before?'?before='+encodeURIComponent(before):''));trackBefore=before;renderTrack();}
  catch(e) {renderTrack(e.message);}
}
function view() {
  if(location.hash==='#main-content' && tab)return;
  const hash=location.hash.slice(1);
  const observationLink=hash==='observe'||hash==='track-90';
  const analysisId=hash.match(/^analysis\/([LO][1-9]\d{3})$/)?.[1];
  const next=observationLink?'track':analysisId?'analysis':sections.includes(hash)?hash:'screen';
  const prior=tab;
  tab=next;
  document.querySelectorAll('.page').forEach(s=>{s.hidden=s.id!==tab;});
  document.querySelectorAll('[data-tab]').forEach(a=>{
    if(a.dataset.tab===tab)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');
  });
  q('#crumb').textContent=titles[sections.indexOf(tab)];
  if(tab==='track'&&prior!==tab)Promise.all([getTrack(),getObservations()]).then(()=>{
    if(tab==='track'&&['#track-90','#observe'].includes(location.hash))q('#track-90').scrollIntoView();
  });
  if(observationLink)q('#track-90').scrollIntoView();
  if(tab==='analysis'&&(analysisId??'')!==analysisCode)getAnalysis(analysisId??'');
}
const modal=q('#detail');
let modalTrigger=null;
let stockRequest=0;
function modalSet(title,body,trigger) {
  q('#detail-title').textContent=title;
  q('#detail-content').innerHTML=body;
  if (!modal.open) {
    modalTrigger=trigger;
    modal.showModal();
  } else if (!modal.contains(document.activeElement)) {
    q('#close-detail').focus({preventScroll:true});
  }
}
modal.addEventListener('close',()=>{
  stockRequest++;
  if (modalTrigger?.isConnected) modalTrigger.focus({preventScroll:true});
  else q('nav [aria-current]').focus({preventScroll:true});
  modalTrigger=null;
});
function stockIndicators(indicators,date){
  const sections=[];
  for(const [name,fields] of Object.entries(ruleGroups.technical.sections)){
    const entries=Object.entries(fields).filter(([key])=>Object.hasOwn(priceWindows,key));
    if(!entries.length)continue;
    const values=entries.map(([key,label])=>{
      const value=indicators[key];
      const formatted=key==='supertrendDirection'&&Number.isFinite(value)?(value>0?'多方':'空方'):f(value,2);
      return '<div><dt>'+E(label)+'</dt><dd>'+E(formatted)+'</dd></div>';
    }).join('');
    sections.push('<details class="indicator-panel"><summary>'+E(name)+'</summary><dl>'+values+'</dl></details>');
  }
  return block('技術指標','日線截至 '+date+'。各項指標可在策略規則中搜尋。','<div class="card-body">'+sections.join('')+'</div>');
}
async function showStock(id,trigger) {
  const token=++stockRequest;
  modalSet(short(id)+' · '+market(id),skeleton(),trigger);
  try {
    const info=await api('stock?id='+encodeURIComponent(id));
    if(token!==stockRequest || !modal.open)return;
    const date=trigger?.dataset.recommendationDate;
    const tracked=date?tracking?.joined.find(r=>r.id===id&&r.date===date):null;
    const p=(date?date===screenData?.date:tab==='screen')?screenData?.rows.find(r=>r.id===id):null;
    const recommendation=tracked??p;
    const d=info.info??{};
    const c=info.cash??{};
    const history=info.history;
    const k='<div class="grid kpis">'+kpi('最新收盤',f(history.at(-1)?.close,2),history.at(-1)?.date)+
      kpi('月營收年增',pct(d.yoy,true),d.month?d.month+' · '+int(d.revenue)+' 千元':'資料缺少')+
      kpi('財報 EPS',f(d.eps,2),d.period??'資料缺少')+kpi('本益比 / 淨值比',f(d.pe,1)+' / '+f(d.pb,1),d.valuationDate??'資料缺少')+
      kpi('營業現金流',int(c.ocf),c.date?c.date+' · 百萬元（累計）':'資料缺少')+
      kpi('自由現金流',int(c.fcf),c.date?c.date+' · 百萬元（累計）':'資料缺少')+
      kpi('千張大戶',int(d.holders1000),d.holdersDate?d.holdersDate+' · 人（逾 100 萬股）':'資料缺少')+'</div>';
    const lines=[['外資',p?.foreign],['投信',p?.trust],['自營商合計',p?.dealer],['自營商自行',p?.active],['自營商避險',p?.hedge]];
    const chips=p?block('近 5 日法人買賣超','',renderTable(['類別','張數'],lines.map(([name,v])=>[name,chipAmount(v)]))):'';
    const reasons=p?block('評分依據',p.date??screenData.date,'<div class="card-body">'+scoreBreakdown(p)+'</div>'):'';
    const activity=recommendation?block('推薦訊號',recommendation.date??screenData.date,
      '<div class="card-body">'+signalBadge(recommendation.signal,true)+'</div>'):'';
    const technical=info.indicators?stockIndicators(info.indicators,history.at(-1)?.date??'—'):'';
    const historyDownload='<div class="controls"><a href="#analysis/'+E(id)+'" class="secondary" data-open-analysis>完整個股分析</a><button type="button" class="secondary" data-history-stock="'+E(id)+'">下載近三年資料</button></div><p id="history-feedback" class="feedback" role="status"></p>';
    modalSet(info.name+' '+short(id)+' · '+market(id),activity+reasons+k+technical+block('收盤價',d.industry??'','<div class="card-body">'+chart(history.map(r=>({date:r.date,value:r.close})),false,v=>f(v,2))+'</div>')+chips+historyDownload);
  } catch(e) {if(token===stockRequest&&modal.open)modalSet(short(id),skeleton(e.message));}
}
function setBusy(button,busy) {
  button.disabled=busy;
  if(busy) button.setAttribute('aria-busy','true');
  else button.removeAttribute('aria-busy');
}
function downloadFile(content,type,name) {
  const url=URL.createObjectURL(new Blob([content],{type}));
  const a=document.createElement('a');
  a.href=url;
  a.download=name;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function downloadCsv() {
  if(!backtest?.rows.length)return;
  const quote=v=>{
    const value=String(v??'');
    const safe=typeof v==='string'&&/^[\s]*[=+@-]/.test(value)?"'"+value:value;
    return '"'+safe.replaceAll('"','""')+'"';
  };
  const names=['訊號日','代號','名稱','進場日','出場日','狀態','毛報酬百分比','淨報酬百分比'];
  const rows=backtest.rows.map(r=>[r.date,short(r.id),r.name,r.entry,r.exit,statusText[r.status],r.gross,r.net]);
  downloadFile('\uFEFF'+[names,...rows].map(r=>r.map(quote).join(',')).join('\r\n'),'text/csv;charset=utf-8','台股策略回測.csv');
}
document.addEventListener('click',async e=>{
  if(e.target.closest('[data-open-analysis]')){modal.close();return;}
  const b=e.target.closest('button');
  if(!b)return;
  if(b.hasAttribute('data-observation'))return showObservation(observationPage.rows[Number(b.dataset.observation)],b);
  if(b.hasAttribute('data-observations-before'))return getObservations(b.dataset.observationsBefore);
  if(b.dataset.stock) return showStock(b.dataset.stock,b);
  if(b.dataset.historyStock) {
    const id=b.dataset.historyStock;
    const feedback=q('#history-feedback');
    setBusy(b,true);
    feedback.textContent='正在取得歷史資料…';
    try {
      const report=await api('stock/history?id='+encodeURIComponent(id));
      if(!b.isConnected)return;
      downloadFile(JSON.stringify(report,null,2),'application/json',short(id)+'-historical-data.json');
      feedback.textContent='已下載 '+report.bars.length+' 個交易日的行情。'+(report.failed.length?'部分來源本次無法取得。':'');
    } catch(error) {feedback.textContent=error.message;}
    finally{setBusy(b,false);}
    return;
  }
  if(b.id==='close-detail') {modal.close();return;}
  if(b.id==='search') {
    modalSet('查詢個股','<form id="lookup" class="form-grid three lookup-fields" autocomplete="off">'+selector('市場','market',[['L','上市'],['O','上櫃']],'L')+
      '<label>股票代碼<input name="code" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" placeholder="例如 2330…" spellcheck="false" required></label><div class="controls"><button class="action" type="submit">查詢</button></div></form>',b);
  }
  if(b.id==='add-rule') {
    const list=q('#rule-list');
    if(list.children.length>=20) q('#settings-feedback').textContent='最多可設定 20 條條件。';
    else {
      list.insertAdjacentHTML('beforeend',ruleRow());
      q('select',list.lastElementChild).focus();
    }
  }
  if(b.classList.contains('remove-rule')) {
    const rule=b.closest('.rule');
    const next=rule.nextElementSibling??rule.previousElementSibling;
    rule.remove();
    (next?q('select',next):q('#add-rule')).focus();
  }
  if(b.id==='reset') {
    renderRules(config(defaults));
    q('#reset').focus({preventScroll:true});
    q('#settings-feedback').textContent='已載入預設值，儲存後生效。';
  }
  if(b.dataset.resultStep) {
    resultPage+=Number(b.dataset.resultStep);
    q('#result-list').innerHTML=resultList(backtest.rows,resultSubtitle(backtest));
    q('#result-list-title').focus();
    q('#result-list-title').scrollIntoView({block:'start'});
  }
  if(b.id==='older') return getTrack(b.dataset.before);
  if(b.id==='latest-track') return getTrack();
  if(b.id==='csv') downloadCsv();
  if(b.id==='refresh') {
    setBusy(b,true);
    try {const r=await api('refresh',{});note(r.state);await getScreen();if(tracking)await Promise.all([getTrack(),getObservations()]);}
    catch(err){note(err.message);}
    finally {
      if(b.isConnected)setBusy(b,false);
      else if(tab==='screen' && document.activeElement===document.body)q('#refresh')?.focus({preventScroll:true});
    }
  }
});
document.addEventListener('submit',async e=>{
  const form=e.target;
  if(!['settings','test-form','lookup','analysis-lookup'].includes(form.id))return;
  e.preventDefault();
  const data=Object.fromEntries(new FormData(form));
  if(form.id==='lookup') return showStock(data.market+data.code);
  if(form.id==='analysis-lookup'){
    const code=data.market+data.code;
    if(analysisCode===code)getAnalysis(code);
    else location.hash='analysis/'+code;
    return;
  }
  const btn=q('button[type=submit]',form);
  const feedback=q(form.id==='settings'?'#settings-feedback':'#backtest-feedback');
  feedback.textContent='';
  const end=q('[name=end]',form);
  end?.removeAttribute('aria-invalid');
  if(form.id==='test-form' && data.start && data.end && data.start>data.end) {
    feedback.textContent='起始日須早於結束日。';
    end.setAttribute('aria-invalid','true');
    end.setAttribute('aria-describedby','backtest-feedback');
    end.focus();
    return;
  }
  setBusy(btn,true);
  try {
    if(form.id==='settings') {
      const rules=[...form.querySelectorAll('.rule')].map(el=>({field:q('[name=ruleField]',el).value,op:q('[name=ruleOp]',el).value,value:q('[name=ruleValue]',el).value}));
      settings=config(await api('settings',config({...data,horizon:+data.horizon,limit:+data.limit,rules})));
      backtest=null;
      renderRules();
      renderBacktest();
      q('#settings-feedback').textContent='已儲存。';
      if(tab==='rules')q('#settings button[type=submit]').focus({preventScroll:true});
      await getScreen();
    } else {
      dates=data;
      feedback.textContent='正在執行回測…';
      backtest=await api('backtest',{...dates,settleThroughEnd:dates.settle==='bounded',config:settings});
      resultPage=0;
      feedback.textContent='';
      showBacktest();
      if(tab==='backtest'){
        q('#result-title').focus();
        q('#result-title').scrollIntoView({block:'start'});
      }
    }
  } catch(err) {
    feedback.textContent=err.message;
  } finally {setBusy(btn,false);}
});
document.addEventListener('change',e=>{
  const field=e.target;
  if(!['ruleGroup','ruleField'].includes(field.name))return;
  const row=field.closest('.rule');
  const group=q('[name=ruleGroup]',row);
  const indicator=q('[name=ruleField]',row);
  if(field.name==='ruleField')group.value=groupForField(field.value);
  indicator.innerHTML=indicatorOptions(group.value,field.name==='ruleField'?field.value:'').options;
  q('[name=ruleQuery]',row).value='';
  q('.rule-query-status',row).textContent='';
  q('[name=ruleValue]',row).value='';
});
document.addEventListener('input',e=>{
  const search=e.target;
  if(search.name!=='ruleQuery')return;
  const row=search.closest('.rule');
  const indicator=q('[name=ruleField]',row);
  const result=indicatorOptions(q('[name=ruleGroup]',row).value,indicator.value,search.value);
  indicator.innerHTML=result.options;
  q('.rule-query-status',row).textContent=result.status;
});
document.addEventListener('keydown',e=>{
  if(e.key!=='Enter'||e.target.name!=='ruleQuery'||e.isComposing)return;
  e.preventDefault();
  const indicator=q('[name=ruleField]',e.target.closest('.rule'));
  if(indicator.querySelector('optgroup'))indicator.focus();
});
window.addEventListener('hashchange',view);
renderScreen();
renderRules();
renderBacktest();
q('#track').innerHTML=heading('推薦追蹤','核對推薦當日的訊號、持有期實際報酬及 90 天表現。',
  '<a class="secondary" href="#track-90">查看 90 天觀察</a>')+'<div id="track-trades"></div><div id="track-90"></div>';
renderTrack();
renderObservations();
renderAnalysis();
renderSources();
view();
api('settings').then(c=>{settings=config(c);if(tab!=='rules'||!document.activeElement.closest('form'))renderRules();}).catch(err=>note(err.message));
getScreen();
