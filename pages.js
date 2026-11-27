// GitHub Pages 入口：在瀏覽器內執行原本的 Worker API，讓 app.mjs 不用改動。
import { api as serverApi } from './server.js';
import { openStaticBucket } from './static-bucket.js';

const site=new URL('./',location.href).href;
const dataBase=site+'data/';
const passthrough=window.fetch.bind(window);
let ready=openStaticBucket(dataBase,passthrough);
let style;
const updatedText=value=>value?new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',dateStyle:'medium',timeStyle:'short',hourCycle:'h23'}).format(new Date(value)):'尚未更新';
// 這些端點會向交易所抓資料或寫入共用資料，Pages 版改由 GitHub Actions 執行。
const actionsOnly=new Set(['/api/ingest','/api/initial','/api/history/import','/api/disclosures/import','/mcp']);
async function local(path,init) {
  const url=new URL(path.replace(/^\//,''),site);
  if(url.pathname.endsWith('/api/refresh')){
    ready=openStaticBucket(dataBase,passthrough);
    const bucket=await ready;
    return Response.json({state:'資料由 GitHub Actions 於交易日自動更新，最後更新：'+updatedText(bucket.updatedAt)+'。'});
  }
  const route=url.pathname.slice(new URL(site).pathname.length-1);
  if(actionsOnly.has(route))return Response.json({error:'此功能由 GitHub Actions 自動執行。'},{status:405});
  style??=await passthrough(site+'style.css').then(r=>r.text()).catch(()=>'');
  const request=new Request(new URL(route+url.search,location.origin),init);
  return serverApi(request,{BUCKET:await ready},style);
}
window.fetch=(input,init)=>typeof input==='string'&&input.startsWith('/api/')?local(input,init):passthrough(input,init);

document.addEventListener('click',async event=>{
  const link=event.target.closest?.('#export-html');
  if(!link)return;
  event.preventDefault();
  const response=await local('/export.html');
  const html=(await response.text()).replaceAll(location.origin+'/#',site+'#');
  const name=/filename="([^"]+)"/.exec(response.headers.get('Content-Disposition')??'')?.[1]??'taiwan-equity-lab.html';
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([html],{type:'text/html'}));
  a.download=name;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),10000);
},true);

await import('./app.js');
