import { ruleFields, signalThresholds } from './model.js';
import { E, average, block, f, heading, int, kpi, market, observationState, pct, pn, scoreBreakdown, short, signalBadge, statusText, renderTable } from './presentation.js';

const snapshotStyles=`
  .snapshot{max-width:1380px;margin:auto}
  .snapshot-nav{display:flex;flex-wrap:wrap;gap:8px;margin-block:0 18px}
  .snapshot section{scroll-margin-top:18px;margin-block:0 24px}
  .snapshot .stockbutton{display:flex;flex-direction:column;justify-content:center}
  .snapshot .records-table td{white-space:normal}
  @media(max-width:767px){.snapshot .records-table td:first-child{grid-row:auto}}
  @media print{.snapshot-nav,.snapshot .page-actions,.snapshot .secondary{display:none}.card{break-inside:avoid}}
`;

function snapshotStock(row,origin) {
  return '<a class="stockbutton" href="'+E(origin+'/#analysis/'+row.id)+'"><span class="stockname">'+
    E(row.name??short(row.id))+'</span><span class="sub">'+E(short(row.id)+' · '+market(row.id))+'</span></a>';
}
function snapshotReturn(value) {
  return '<span class="'+pn(value)+'">'+pct(value,true)+'</span>';
}
function snapshotPicks(data,origin) {
  const probabilities=data.rows.map(row=>row.forecast?.prob).filter(Number.isFinite);
  const cards='<div class="grid kpis">'+
    kpi('建議購入',int(data.rows.filter(row=>row.signal?.kind==='buy').length)+' / '+int(data.config?.limit))+
    kpi('候選平均上漲機率',pct(average(probabilities)),probabilities.length?'可估計 '+probabilities.length+' 檔':'樣本不足')+
    kpi('涵蓋股票',int(data.count),'上市＋上櫃普通股')+
    kpi('預測持有期',int(data.config?.horizon)+' 日','次一交易日開盤進場')+'</div>';
  const rows=data.rows.map(row=>[
    snapshotStock(row,origin),'<strong>'+f(row.close,2)+'</strong><div class="sub">'+pct(row.change,true)+'</div>',
    '<span class="badge green">'+f(row.score)+'</span>',scoreBreakdown(row),E(row.leader??'—'),pct(row.forecast?.prob),
    snapshotReturn(row.forecast?.upside),signalBadge(row.signal)
  ]);
  const note=[data.frozen?'已保存當日推薦':'研究預覽',data.date?'行情 '+data.date:null,
    data.fundamentalsDate?'基本面 '+data.fundamentalsDate:null].filter(Boolean).join(' · ');
  return cards+block('每日選股',note,rows.length?
    renderTable(['股票','收盤價','綜合分數','評分依據','5 日主要買超','預測上漲機率','預期價差','推薦訊號'],rows,'picks-table'):
    '<div class="empty">目前沒有符合條件的候選。</div>');
}
function snapshotTracking(tracking,observations,origin) {
  const summary=tracking.summary;
  const trades=tracking.joined.map(row=>[E(row.date),snapshotStock(row,origin),int(row.horizon)+' 日',pct(row.forecast?.prob),
    snapshotReturn(row.forecast?.upside),E(row.exit??'—'),snapshotReturn(row.gross),snapshotReturn(row.net),
    signalBadge(row.signal),E(statusText[row.status]??'待核對')]);
  const reviews=observations.rows.map(row=>[E(row.date),snapshotStock(row,origin),signalBadge(row.signal),
    E(observationState[row.state]??'待核對'),snapshotReturn(row.latest?.value),
    ...[30,60,90].map(days=>snapshotReturn(row.checkpoints[days]?.value))]);
  const tradeTable=trades.length?renderTable(['推薦日','股票','持有期','預測上漲機率','預期價差','結算日','實際毛報酬','實際淨報酬','推薦訊號','交易狀態'],trades,'records-table'):
    '<div class="empty">目前沒有持有期交易明細。</div>';
  const reviewTable=reviews.length?renderTable(['推薦日','股票','推薦訊號','觀察進度','最近價差','30 天','60 天','90 天'],reviews,'records-table'):
    '<div class="empty">目前沒有 90 天觀察紀錄。</div>';
  return '<div class="grid kpis">'+kpi('推薦筆數',int(summary.total))+kpi('已結算',int(summary.done))+
    kpi('實際淨勝率',pct(summary.win))+kpi('平均實際淨報酬',pct(summary.net,true))+'</div>'+
    block('推薦追蹤','持有期交易明細 · 最近 '+tracking.logs.length+' 份交易日紀錄',tradeTable)+
    block('90 天觀察','價差未扣交易成本。'+(observations.asOf?' 行情更新至 '+observations.asOf+'。':''),reviewTable);
}
function snapshotRules(conf,origin) {
  const markets={all:'上市＋上櫃',L:'上市',O:'上櫃'};
  const operators={gt:'>',gte:'≥',lt:'<',lte:'≤',eq:'='};
  const rows=[
    ['市場',markets[conf.market]],['候選上限',int(conf.limit)+' 檔'],['持有期',int(conf.horizon)+' 日'],
    ['最低綜合分數',int(conf.score)],['最低 20 日均成交額',int(conf.amount)+' 百萬元'],
    ['技術／基本／籌碼權重',[conf.tech,conf.fund,conf.chip].map(int).join('／')],
    ['手續費／賣出稅／滑價',[conf.fee,conf.tax,conf.slip].map(value=>f(value,4)+'%').join('／')]
  ];
  const rules=conf.rules.map(rule=>E(ruleFields[rule.field])+' '+E(operators[rule.op])+' '+E(rule.value));
  return block('策略規則','匯出時的已保存設定。',renderTable(['設定','數值'],rows.map(row=>row.map(E)),'records-table')+
    '<div class="card-body"><h3>自訂條件</h3>'+(rules.length?'<ul><li>'+rules.join('</li><li>')+'</li></ul>':'<p class="note">目前沒有自訂條件。</p>')+
    '<a class="secondary" href="'+E(origin+'/#rules')+'">開啟線上策略規則</a></div>');
}
export function renderHtmlSnapshot({picks,tracking,observations,conf,origin,exportedAt,style}) {
  const online=(path,label)=>'<a class="secondary" href="'+E(origin+path)+'">'+E(label)+'</a>';
  return '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">'+
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'+
    '<meta name="color-scheme" content="light"><title>台股策略研究台 · HTML 匯出</title><style>'+style+snapshotStyles+'</style></head><body>'+
    '<main class="content snapshot">'+heading('台股策略研究台','HTML 匯出 · '+exportedAt+'（台灣時間）',online('/#screen','開啟線上研究台'))+
    '<p class="state">此檔可離線查看匯出時的資料。更新行情、修改策略、執行回測及查詢個股請使用線上研究台。</p>'+
    '<div class="snapshot-nav" role="navigation" aria-label="匯出內容">'+
    '<a class="secondary" href="#screen">每日選股</a><a class="secondary" href="#rules">策略規則</a>'+
    '<a class="secondary" href="#track">推薦追蹤</a><a class="secondary" href="#sources">資料與方法</a>'+
    online('/#backtest','線上回測')+online('/#analysis','線上個股分析')+'</div>'+
    '<section id="screen">'+snapshotPicks(picks,origin)+'</section>'+
    '<section id="rules">'+snapshotRules(conf,origin)+'</section>'+
    '<section id="track">'+snapshotTracking(tracking,observations,origin)+'</section>'+
    '<section id="sources">'+block('資料與方法','','<div class="card-body"><ul>'+
      '<li>主力建倉訊號採近 5 日法人淨額，至少 '+signalThresholds.flowDays+' 日淨買超，且合計占成交量達 '+signalThresholds.flow+'%。</li>'+
      '<li>預測上漲機率與價差依已結算的相似歷史樣本估計。持有期淨報酬含手續費、賣出稅與滑價。</li>'+
      '</ul>'+online('/#sources','查閱線上資料與方法')+'</div>')+'</section></main></body></html>';
}
