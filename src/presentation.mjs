import { fundamentalFactors, signalLabels } from './model.mjs';

export const E=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const nf=new Intl.NumberFormat('zh-TW',{maximumFractionDigits:1});
export const f=(v,d=1)=>Number.isFinite(v)?v.toFixed(d):'—';
export const int=v=>Number.isFinite(v)?nf.format(v):'—';
export const pct=(v,sign=false)=>Number.isFinite(v)?(sign&&v>0?'+':'')+f(v)+'%':'—';
export const pn=v=>v>0?'positive':v<0?'negative':'';
export const market=id=>id?.[0]==='L'?'上市':'上櫃';
export const short=id=>id.slice(1);
export const average=values=>values.length ? values.reduce((a,b)=>a+b,0)/values.length : null;
export const statusText={done:'已結算',waiting:'等待進場',holding:'持有中',missing:'缺少行情',action:'涉及公司行動',unfilled:'鎖漲跌停・假設未成交',calendar:'交易日待核對'};

export function heading(title,desc,actions='') {
  return '<header class="page-head"><div><h1>'+E(title)+'</h1><p>'+E(desc)+'</p></div>'+
    (actions?'<div class="controls page-actions">'+actions+'</div>':'')+'</header>';
}
export function kpi(label,value,detail='') {
  return '<div class="kpi"><span>'+E(label)+'</span><b>'+E(value)+'</b><small>'+E(detail)+'</small></div>';
}
export function block(title,sub,body,actions='',id='') {
  return '<div class="card"><div class="card-head"><div><h2'+(id?' id="'+id+'" tabindex="-1"':'')+'>'+E(title)+'</h2>'+
    (sub?'<p>'+E(sub)+'</p>':'')+'</div>'+actions+'</div>'+body+'</div>';
}
export function renderTable(labels, rows, variant='') {
  const header=labels.map(x=>'<th role="columnheader" scope="col">'+E(x)+'</th>').join('');
  const body=rows.map(row=>'<tr role="row">'+row.map((cell,i)=>'<td role="cell">'+
    (variant?'<span class="mobile-label" aria-hidden="true">'+E(labels[i])+'</span>':'')+
    '<div class="cell-value">'+cell+'</div></td>').join('')+'</tr>').join('');
  return '<div class="table-wrap"><table role="table"'+(variant?' class="stack-table '+variant+'"':'')+
    '><thead role="rowgroup"><tr role="row">'+header+'</tr></thead><tbody role="rowgroup">'+body+'</tbody></table></div>';
}

export function chipAmount(value) {return Number.isFinite(value)?(value>0?'+':'')+int(value)+' 張':'—';}
const scoreEffect=value=>value>0?'，加分':value<0?'，減分':'，中性';
function scoreReasons(row) {
  const technical=[],fundamental=[],ownership=[];
  if(Number.isFinite(row.momentum))technical.push('20 日動能 '+pct(row.momentum,true)+scoreEffect(row.momentum));
  if(Number.isFinite(row.above))technical.push('MA20 均線乖離 '+pct(row.above,true)+scoreEffect(row.above));
  if(Number.isFinite(row.volume)){
    const direction=row.change>0?'上漲':row.change<0?'下跌':'持平';
    const daily=Number.isFinite(row.change)?'，當日'+direction+(row.change?' '+pct(row.change,true):''):'';
    const effect=(row.volume-1)*Math.sign(row.change);
    const impact=Number.isFinite(effect)?scoreEffect(effect):'';
    technical.push('量價方向為量比 '+f(row.volume,2)+' 倍'+daily+impact);
  }
  const fundamentals={
    yoy:'月營收年增率 '+pct(row.yoy,true),
    eps:'財報 EPS '+f(row.eps,2)+' 元',
    pe:'本益比 '+f(row.pe,1)+' 倍',
    ocf:'營業現金流 '+int(row.ocf)+' 百萬元'
  };
  for(const [field,value] of fundamentalFactors(row)){
    fundamental.push(fundamentals[field]+(Number.isFinite(row.fund)?scoreEffect(value-50):''));
  }
  for(const [label,value] of [['外資',row.foreign],['投信',row.trust],['自營商自行',row.active]]){
    if(Number.isFinite(value)){
      const side=value>0?'買超':value<0?'賣超':'淨額';
      ownership.push(label+side+' '+int(Math.abs(value))+' 張');
    }
  }
  if(ownership.length)ownership[0]='近 5 日'+ownership[0];
  if(Number.isFinite(row.chipRatio))ownership.push('上述合計占同期成交量 '+pct(row.chipRatio,true)+scoreEffect(row.chipRatio));
  return [
    ['技術面',technical,row.tech],['基本面',fundamental,row.fund],['籌碼面',ownership,row.chip]
  ];
}
export function scoreBreakdown(row) {
  return '<ul class="score-breakdown">'+scoreReasons(row).map(([label,reasons,score])=>
    '<li><strong>'+label+'</strong> '+E(reasons.join('、')||'計分資料不足')+
    '<b class="factor-score">（'+(Number.isFinite(score)?f(score)+' 分':'未評分')+'）</b></li>').join('')+'</ul>';
}
export function signalBadge(signal={kind:'unknown'},expanded=false) {
  const {kind,days,ratio,leader,prob,upside}=signal;
  const tone=({buy:'green',accumulation:'build',pressure:'pressure'})[kind]??'';
  let reason;
  if(kind==='unknown'){
    reason='近 5 日法人資料待核對';
  } else if(kind==='watch'){
    reason='法人買賣超未達訊號門檻';
  } else {
    reason=days+'／5 日'+(kind==='pressure'?'淨賣超':'淨買超')+' · '+(leader??'法人合計');
    if(expanded){
      reason+=' · 占成交量 '+pct(ratio,true);
      if(kind==='buy')reason+=' · 預測上漲機率 '+pct(prob)+'、預期價差 '+pct(upside,true)+'，高於策略交易成本';
    }
  }
  return '<div class="market-signal"><span class="badge '+tone+'">'+E(signalLabels[kind]??signalLabels.unknown)+'</span><span class="sub">'+E(reason)+'</span></div>';
}

export const observationState={
  waiting:'等待首個交易日', observing:'觀察中', complete:'已滿 90 天',
  action:'公司行動待核對', calendar:'交易日待核對', missing:'行情缺漏'
};
