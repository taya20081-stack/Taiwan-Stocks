// 暫時驗證用：在真實資料上統計基本面覆蓋率（驗證完會移除）。
import { api } from '../src/server.mjs';
import { fundamentalFactors } from '../src/model.mjs';
import { openFsBucket } from './fs-bucket.mjs';
const bucket=await openFsBucket(process.argv[2]);
const env={BUCKET:bucket};
const post=async p=>(await api(new Request('https://x.invalid'+p,{method:'POST',body:'{}',headers:{'Content-Type':'application/json'}}),env)).json();
console.log('refresh',JSON.stringify(await post('/api/fundamentals/refresh')));
const research=await (await bucket.get('research'))?.json();
const recs=Object.values(research?.records??{});
const ok=recs.filter(r=>fundamentalFactors({yoy:r.yoy,eps:r.eps,pe:r.pe,ocf:null}).length>=2);
console.log('records',recs.length,'scorable(>=2 factors w/o ocf)',ok.length,(100*ok.length/recs.length).toFixed(1)+'%');
for(const id of ['L1477','O3285']){const r=research?.records?.[id];console.log(id,JSON.stringify(r&&{name:r.name,yoy:r.yoy,eps:r.eps,pe:r.pe,month:r.month,period:r.period}));}
const picks=await (await api(new Request('https://x.invalid/api/picks'),env)).json();
console.log('picks date',picks.date,'frame',picks.frame,'fundamentalsDate',picks.fundamentalsDate,'valuation',picks.valuation,'cash',picks.cash);
for(const r of picks.rows)console.log(r.id,r.name,'score',r.score?.toFixed(1),'tech',r.tech?.toFixed(1),'fund',r.fund?.toFixed(1),'chip',r.chip?.toFixed(1),'yoy',r.yoy,'eps',r.eps,'pe',r.pe,'ocf',r.ocf);
const loose=await (await api(new Request('https://x.invalid/api/settings',{method:'POST',body:JSON.stringify({score:0,limit:5,amount:0}),headers:{'Content-Type':'application/json'}}),env)).json();
const all=await (await api(new Request('https://x.invalid/api/picks'),env)).json();
console.log('loose picks',all.rows.map(r=>r.id+':fund='+(r.fund==null?'null':r.fund.toFixed(0))).join(' '));
